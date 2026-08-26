import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import {
  InsurerAdapter, AdapterContext,
  AffiliateQuery, AffiliateStatus,
  PracticeAuthorizationRequest, AuthorizationResult,
  BatchSubmission, BatchResult, HubStatus,
} from './adapters/adapter.interface';
import { GenericRestAdapter } from './adapters/generic-rest.adapter';
import { ManualAdapter } from './adapters/manual.adapter';

interface ConnectorRow {
  id: string;
  insurer_id: string;
  adapter_key: string;
  kind: string;
  priority: number;
  config: Record<string, unknown>;
  health: string;
  consecutive_failures: number;
  can_validate_affiliate: boolean;
  can_authorize_practice: boolean;
  can_submit_batch: boolean;
}

@Injectable()
export class HubService implements OnModuleInit {
  private readonly logger = new Logger(HubService.name);
  private readonly registry = new Map<string, InsurerAdapter>();

  /** Después de N fallos seguidos, el conector se saltea */
  private readonly FAILURE_THRESHOLD = 5;

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private genericRest: GenericRestAdapter,
    private manual: ManualAdapter,
  ) {}

  onModuleInit() {
    this.register(this.genericRest);
    this.register(this.manual);
    this.logger.log(`Hub listo con ${this.registry.size} adaptadores: ${[...this.registry.keys()].join(', ')}`);
  }

  /** Los adaptadores nuevos se registran acá */
  register(adapter: InsurerAdapter) {
    this.registry.set(adapter.key, adapter);
  }

  // ═══════════════════════════════════════════════════════════
  // VALIDACIÓN DE AFILIADO
  // ═══════════════════════════════════════════════════════════

  async validateAffiliate(
    orgId: string,
    insurerId: string,
    query: AffiliateQuery,
    opts: { skipCache?: boolean; patientId?: string } = {},
  ): Promise<AffiliateStatus & { insurerId: string; cached: boolean; connector?: string }> {
    // 1. Caché — un afiliado validado hace minutos no se revalida
    if (!opts.skipCache) {
      const cached = await this.readCache(insurerId, query);
      if (cached) {
        return { ...cached, insurerId, cached: true };
      }
    }

    // 2. Cadena de conectores por prioridad
    const connectors = await this.connectorsFor(insurerId, 'can_validate_affiliate');
    if (!connectors.length) {
      return {
        status: 'manual_review',
        isValid: false,
        insurerId,
        cached: false,
        message: 'Esta obra social todavía no tiene conector configurado.',
      };
    }

    const requestId = await this.openRequest(orgId, insurerId, 'validate', query, opts.patientId);

    for (const connector of connectors) {
      const adapter = this.registry.get(connector.adapter_key);
      if (!adapter) {
        this.logger.warn(`Adaptador '${connector.adapter_key}' no registrado`);
        continue;
      }

      const started = Date.now();
      try {
        const ctx = await this.buildContext(orgId, connector, requestId);
        const result = await adapter.validateAffiliate(query, ctx);
        const latency = Date.now() - started;

        // Un error del conector no es un rechazo: probamos el siguiente
        if (result.status === 'error') {
          await this.markFailure(connector.id, latency);
          continue;
        }

        await this.markSuccess(connector.id, latency);
        await this.closeRequest(requestId, connector.id, result.status, result, latency);

        if (result.isValid && result.cacheSeconds) {
          await this.writeCache(insurerId, query, result);
        }

        return { ...result, insurerId, cached: false, connector: adapter.displayName };
      } catch (err) {
        await this.markFailure(connector.id, Date.now() - started);
        this.logger.warn(`Conector ${connector.adapter_key} falló: ${err.message}`);
      }
    }

    // Se agotaron todos
    await this.closeRequest(requestId, null, 'error', { message: 'Todos los conectores fallaron' }, 0);
    return {
      status: 'error',
      isValid: false,
      insurerId,
      cached: false,
      message: 'No pudimos validar en este momento. Reintentá en unos minutos.',
    };
  }

  // ═══════════════════════════════════════════════════════════
  // AUTORIZACIÓN DE PRÁCTICA
  // ═══════════════════════════════════════════════════════════

  async authorizePractice(
    orgId: string,
    insurerId: string,
    req: PracticeAuthorizationRequest,
    opts: { patientId?: string; appointmentId?: string } = {},
  ): Promise<AuthorizationResult & { insurerId: string; connector?: string }> {
    const connectors = await this.connectorsFor(insurerId, 'can_authorize_practice');
    if (!connectors.length) {
      return {
        status: 'manual_review',
        insurerId,
        message: 'Autorización manual requerida para esta obra social.',
      };
    }

    const requestId = await this.openRequest(
      orgId, insurerId, 'authorize', req, opts.patientId, opts.appointmentId,
    );

    for (const connector of connectors) {
      const adapter = this.registry.get(connector.adapter_key);
      if (!adapter) continue;

      const started = Date.now();
      try {
        const ctx = await this.buildContext(orgId, connector, requestId);
        const result = await adapter.authorizePractice(req, ctx);
        const latency = Date.now() - started;

        if (result.status === 'error') {
          await this.markFailure(connector.id, latency);
          continue;
        }

        await this.markSuccess(connector.id, latency);
        await this.closeRequest(
          requestId, connector.id, result.status, result, latency, result.authorizationCode,
        );

        return { ...result, insurerId, connector: adapter.displayName };
      } catch (err) {
        await this.markFailure(connector.id, Date.now() - started);
      }
    }

    await this.closeRequest(requestId, null, 'error', {}, 0);
    return { status: 'error', insurerId, message: 'No se pudo obtener autorización.' };
  }

  // ═══════════════════════════════════════════════════════════
  // PRESENTACIÓN DE LOTE
  // ═══════════════════════════════════════════════════════════

  async submitBatch(
    orgId: string,
    insurerId: string,
    batch: BatchSubmission,
  ): Promise<BatchResult & { insurerId: string }> {
    const connectors = await this.connectorsFor(insurerId, 'can_submit_batch');
    if (!connectors.length) {
      return { status: 'manual_review', insurerId, message: 'Presentación manual.' };
    }

    const requestId = await this.openRequest(orgId, insurerId, 'submit_batch', {
      periodYear: batch.periodYear,
      periodMonth: batch.periodMonth,
      itemCount: batch.items.length,
    });

    for (const connector of connectors) {
      const adapter = this.registry.get(connector.adapter_key);
      if (!adapter) continue;

      const started = Date.now();
      try {
        const ctx = await this.buildContext(orgId, connector, requestId);
        const result = await adapter.submitBatch(batch, ctx);
        const latency = Date.now() - started;

        if (result.status === 'error') {
          await this.markFailure(connector.id, latency);
          continue;
        }

        await this.markSuccess(connector.id, latency);
        await this.closeRequest(requestId, connector.id, result.status, result, latency);
        return { ...result, insurerId };
      } catch (err) {
        await this.markFailure(connector.id, Date.now() - started);
      }
    }

    await this.closeRequest(requestId, null, 'error', {}, 0);
    return { status: 'error', insurerId, message: 'No se pudo presentar el lote.' };
  }

  // ═══════════════════════════════════════════════════════════
  // COBERTURA DEL HUB (para mostrar en la app y vender)
  // ═══════════════════════════════════════════════════════════

  async getCoverage(filters: { province?: string; search?: string } = {}) {
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    let i = 1;

    if (filters.province) {
      where += ` AND (province = $${i} OR province IS NULL)`;
      params.push(filters.province);
      i++;
    }
    if (filters.search) {
      where += ` AND name ILIKE $${i}`;
      params.push(`%${filters.search}%`);
      i++;
    }

    const rows = await this.db.queryMany(
      `SELECT * FROM v_hub_coverage ${where}
       ORDER BY affiliate_count DESC NULLS LAST, name`,
      params,
    );

    const summary = {
      total: rows.length,
      automated: rows.filter(r => r.primary_kind === 'api' || r.primary_kind === 'portal').length,
      manual: rows.filter(r => r.primary_kind === 'manual').length,
      unmapped: rows.filter(r => !r.connector_count).length,
    };

    return { summary, insurers: rows };
  }

  /** Resuelve el financiador a partir de texto libre que escribe el médico */
  async resolveInsurer(text: string) {
    if (!text?.trim()) return null;

    const exact = await this.db.queryOne(
      `SELECT * FROM insurers
       WHERE is_active
         AND (LOWER(name) = LOWER($1) OR LOWER(short_name) = LOWER($1) OR $1 = ANY(aliases))
       LIMIT 1`,
      [text.trim()],
    );
    if (exact) return exact;

    return this.db.queryOne(
      `SELECT *, similarity(name, $1) AS score FROM insurers
       WHERE is_active AND name ILIKE '%' || $1 || '%'
       ORDER BY affiliate_count DESC NULLS LAST
       LIMIT 1`,
      [text.trim()],
    );
  }

  // ═══════════════════════════════════════════════════════════
  // INTERNAS
  // ═══════════════════════════════════════════════════════════

  /** Conectores habilitados y sanos, en orden de prioridad */
  private async connectorsFor(insurerId: string, capability: string): Promise<ConnectorRow[]> {
    return this.db.queryMany<ConnectorRow>(
      `SELECT * FROM connectors
       WHERE insurer_id = $1
         AND is_enabled = true
         AND ${capability} = true
         AND (health != 'down' OR consecutive_failures < $2)
       ORDER BY
         CASE health WHEN 'healthy' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END,
         priority`,
      [insurerId, this.FAILURE_THRESHOLD],
    );
  }

  /** Arma el contexto con las credenciales descifradas del consultorio */
  private async buildContext(
    orgId: string,
    connector: ConnectorRow,
    requestId: string,
  ): Promise<AdapterContext> {
    const key = this.config.get<string>('ENCRYPTION_KEY') ?? '';

    const cred = await this.db.queryOne(
      `SELECT provider_code, provider_cuit,
              pgp_sym_decrypt(username_enc, $3) AS username,
              pgp_sym_decrypt(password_enc, $3) AS password,
              pgp_sym_decrypt(extra_enc, $3) AS extra
       FROM provider_credentials
       WHERE organization_id = $1 AND insurer_id = $2 AND is_valid = true`,
      [orgId, connector.insurer_id, key],
    );

    return {
      credentials: {
        username: cred?.username,
        password: cred?.password,
        providerCode: cred?.provider_code,
        providerCuit: cred?.provider_cuit,
        extra: cred?.extra ? JSON.parse(cred.extra) : undefined,
      },
      config: { ...connector.config, insurerId: connector.insurer_id },
      requestId,
      organizationId: orgId,
      timeoutMs: (connector.config?.['timeoutMs'] as number) ?? 15000,
    };
  }

  // ─── Caché ────────────────────────────────────────────────

  private async readCache(insurerId: string, query: AffiliateQuery): Promise<AffiliateStatus | null> {
    const affiliate = query.affiliateNumber?.replace(/[\s-]/g, '').toUpperCase();
    const doc = query.documentNumber?.replace(/\D/g, '');
    if (!affiliate && !doc) return null;

    const row = await this.db.queryOne(
      `SELECT * FROM affiliate_cache
       WHERE insurer_id = $1
         AND expires_at > NOW()
         AND (affiliate_number = $2 OR document_number = $3)
       LIMIT 1`,
      [insurerId, affiliate ?? '', doc ?? ''],
    );
    if (!row) return null;

    return {
      status: row.is_valid ? 'approved' : 'rejected',
      isValid: row.is_valid,
      fullName: row.full_name,
      documentNumber: row.document_number,
      planCode: row.plan_code,
      planName: row.plan_name,
      coverage: row.coverage ?? {},
    };
  }

  private async writeCache(insurerId: string, query: AffiliateQuery, result: AffiliateStatus) {
    const affiliate = query.affiliateNumber?.replace(/[\s-]/g, '').toUpperCase();
    if (!affiliate) return;

    const seconds = result.cacheSeconds ?? 600;

    await this.db.query(
      `INSERT INTO affiliate_cache
         (insurer_id, affiliate_number, document_number, is_valid,
          full_name, plan_code, plan_name, coverage, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() + ($9 || ' seconds')::interval)
       ON CONFLICT (insurer_id, affiliate_number) DO UPDATE SET
         is_valid = EXCLUDED.is_valid,
         full_name = EXCLUDED.full_name,
         plan_code = EXCLUDED.plan_code,
         plan_name = EXCLUDED.plan_name,
         coverage = EXCLUDED.coverage,
         validated_at = NOW(),
         expires_at = EXCLUDED.expires_at`,
      [
        insurerId, affiliate,
        result.documentNumber ?? query.documentNumber?.replace(/\D/g, '') ?? null,
        result.isValid, result.fullName ?? null,
        result.planCode ?? null, result.planName ?? null,
        JSON.stringify(result.coverage ?? {}), String(seconds),
      ],
    );
  }

  // ─── Trazabilidad ─────────────────────────────────────────

  private async openRequest(
    orgId: string, insurerId: string, operation: string,
    payload: unknown, patientId?: string, appointmentId?: string,
  ): Promise<string> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO hub_requests
         (id, organization_id, insurer_id, operation, payload, patient_id, appointment_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [randomUUID(), orgId, insurerId, operation, JSON.stringify(payload),
       patientId ?? null, appointmentId ?? null],
    );
    return row.id;
  }

  private async closeRequest(
    requestId: string, connectorId: string | null, status: HubStatus,
    response: unknown, latencyMs: number, authCode?: string,
  ) {
    await this.db.query(
      `UPDATE hub_requests
       SET connector_id = $1, result = $2, response = $3,
           latency_ms = $4, authorization_code = $5,
           attempts = attempts + 1, completed_at = NOW()
       WHERE id = $6`,
      [connectorId, status, JSON.stringify(response), latencyMs, authCode ?? null, requestId],
    );
  }

  // ─── Salud de conectores ──────────────────────────────────

  private async markSuccess(connectorId: string, latencyMs: number) {
    await this.db.query(
      `UPDATE connectors
       SET health = 'healthy',
           last_success_at = NOW(),
           consecutive_failures = 0,
           avg_latency_ms = COALESCE((avg_latency_ms * 3 + $2) / 4, $2)
       WHERE id = $1`,
      [connectorId, latencyMs],
    );
  }

  private async markFailure(connectorId: string, latencyMs: number) {
    await this.db.query(
      `UPDATE connectors
       SET consecutive_failures = consecutive_failures + 1,
           last_failure_at = NOW(),
           health = CASE
             WHEN consecutive_failures + 1 >= $2 THEN 'down'::connector_health
             ELSE 'degraded'::connector_health
           END
       WHERE id = $1`,
      [connectorId, this.FAILURE_THRESHOLD],
    );
  }
}
