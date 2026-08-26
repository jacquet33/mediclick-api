import { Injectable, Logger } from '@nestjs/common';
import {
  InsurerAdapter, AdapterContext, AdapterCapabilities,
  AffiliateQuery, AffiliateStatus,
  PracticeAuthorizationRequest, AuthorizationResult,
  BatchSubmission, BatchResult,
} from './adapter.interface';

/**
 * Adaptador REST genérico, manejado por configuración.
 *
 * Sirve para cualquier obra social que exponga una API HTTP.
 * En vez de escribir una clase nueva por cada una, se carga
 * la config del conector en la base y este adaptador la ejecuta.
 *
 * Ejemplo de config para una obra social ficticia:
 * {
 *   "baseUrl": "https://api.obrasocial.com.ar/v1",
 *   "auth": { "type": "basic" },
 *   "endpoints": {
 *     "validate": {
 *       "method": "GET",
 *       "path": "/afiliados/{affiliateNumber}",
 *       "map": {
 *         "isValid": "data.activo",
 *         "fullName": "data.nombreCompleto",
 *         "planCode": "data.plan.codigo"
 *       }
 *     }
 *   }
 * }
 */
@Injectable()
export class GenericRestAdapter extends InsurerAdapter {
  readonly key = 'generic_rest';
  readonly displayName = 'REST genérico';
  readonly capabilities: AdapterCapabilities = {
    validateAffiliate: true,
    authorizePractice: true,
    submitBatch: true,
    queryBatchStatus: true,
  };

  private readonly logger = new Logger(GenericRestAdapter.name);

  // ─── Verificación de credenciales ─────────────────────────

  async verifyCredentials(ctx: AdapterContext) {
    const ep = this.endpoint(ctx, 'verify') ?? this.endpoint(ctx, 'validate');
    if (!ep) return { valid: true, message: 'Sin endpoint de verificación configurado' };

    try {
      const res = await this.call(ctx, 'verify', {});
      return { valid: res.ok, message: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  // ─── Validación de afiliado ───────────────────────────────

  async validateAffiliate(query: AffiliateQuery, ctx: AdapterContext): Promise<AffiliateStatus> {
    const vars = {
      affiliateNumber: this.normalizeAffiliate(query.affiliateNumber) ?? '',
      documentNumber: this.normalizeDocument(query.documentNumber) ?? '',
      cuil: query.cuil ?? '',
      planCode: query.planCode ?? '',
      providerCode: ctx.credentials.providerCode ?? '',
      providerCuit: ctx.credentials.providerCuit ?? '',
    };

    try {
      const res = await this.call(ctx, 'validate', vars);
      const body = await this.parseBody(res);

      if (!res.ok) {
        return {
          status: res.status >= 500 ? 'error' : 'rejected',
          isValid: false,
          message: (this.pick(body, this.mapping(ctx, 'validate', 'message')) as string) ?? `HTTP ${res.status}`,
          raw: body,
        };
      }

      const map = (field: string) => this.pick(body, this.mapping(ctx, 'validate', field));
      const isValid = this.truthy(map('isValid'));

      return {
        status: isValid ? 'approved' : 'rejected',
        isValid,
        fullName: map('fullName') as string,
        documentNumber: map('documentNumber') as string,
        planCode: map('planCode') as string,
        planName: map('planName') as string,
        coverageUntil: map('coverageUntil') as string,
        coverage: (map('coverage') as Record<string, unknown>) ?? {},
        cacheSeconds: this.num(ctx.config['cacheSeconds']) ?? 600,
        message: map('message') as string,
        raw: body,
      };
    } catch (err) {
      this.logger.warn(`validateAffiliate falló [${ctx.requestId}]: ${err.message}`);
      return { status: 'error', isValid: false, message: err.message };
    }
  }

  // ─── Autorización de práctica ─────────────────────────────

  async authorizePractice(
    req: PracticeAuthorizationRequest,
    ctx: AdapterContext,
  ): Promise<AuthorizationResult> {
    const vars = {
      affiliateNumber: this.normalizeAffiliate(req.affiliate.affiliateNumber) ?? '',
      documentNumber: this.normalizeDocument(req.affiliate.documentNumber) ?? '',
      practiceCode: req.practiceCode,
      diagnosisCode: req.diagnosisCode ?? '',
      diagnosis: req.diagnosis ?? '',
      serviceDate: req.serviceDate,
      quantity: String(req.quantity ?? 1),
      professionalLicense: req.professionalLicense,
      professionalSpecialty: req.professionalSpecialty ?? '',
      providerCode: ctx.credentials.providerCode ?? '',
      providerCuit: ctx.credentials.providerCuit ?? '',
    };

    try {
      const res = await this.call(ctx, 'authorize', vars);
      const body = await this.parseBody(res);
      const map = (f: string) => this.pick(body, this.mapping(ctx, 'authorize', f));

      if (!res.ok) {
        return {
          status: res.status >= 500 ? 'error' : 'rejected',
          message: (map('message') as string) ?? `HTTP ${res.status}`,
          raw: body,
        };
      }

      const code = map('authorizationCode') as string;

      return {
        status: code ? 'approved' : 'pending',
        authorizationCode: code,
        coveredAmount: this.num(map('coveredAmount')),
        coinsurance: this.num(map('coinsurance')),
        validUntil: map('validUntil') as string,
        requiresPaperwork: this.truthy(map('requiresPaperwork')),
        message: map('message') as string,
        raw: body,
      };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  // ─── Presentación de lote ─────────────────────────────────

  async submitBatch(batch: BatchSubmission, ctx: AdapterContext): Promise<BatchResult> {
    try {
      const res = await this.call(ctx, 'submitBatch', {
        periodYear: String(batch.periodYear),
        periodMonth: String(batch.periodMonth).padStart(2, '0'),
        providerCode: ctx.credentials.providerCode ?? '',
        providerCuit: ctx.credentials.providerCuit ?? '',
      }, batch.items);

      const body = await this.parseBody(res);
      const map = (f: string) => this.pick(body, this.mapping(ctx, 'submitBatch', f));

      if (!res.ok) {
        return { status: 'rejected', message: (map('message') as string) ?? `HTTP ${res.status}`, raw: body };
      }

      return {
        status: 'approved',
        batchNumber: map('batchNumber') as string,
        acceptedItems: this.num(map('acceptedItems')),
        rejectedItems: this.num(map('rejectedItems')),
        acceptedAmount: this.num(map('acceptedAmount')),
        rejections: (map('rejections') as BatchResult['rejections']) ?? [],
        receiptUrl: map('receiptUrl') as string,
        raw: body,
      };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  async queryBatchStatus(batchNumber: string, ctx: AdapterContext): Promise<BatchResult> {
    try {
      const res = await this.call(ctx, 'queryBatch', { batchNumber });
      const body = await this.parseBody(res);
      const map = (f: string) => this.pick(body, this.mapping(ctx, 'queryBatch', f));

      return {
        status: res.ok ? 'approved' : 'error',
        batchNumber,
        acceptedItems: this.num(map('acceptedItems')),
        rejectedItems: this.num(map('rejectedItems')),
        acceptedAmount: this.num(map('acceptedAmount')),
        rejections: (map('rejections') as BatchResult['rejections']) ?? [],
        raw: body,
      };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  async healthCheck(ctx: AdapterContext): Promise<boolean> {
    const url = ctx.config['healthUrl'] as string;
    if (!url) return true;
    try {
      const res = await this.fetchWithTimeout(url, { method: 'GET' }, 5000);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── Motor ────────────────────────────────────────────────

  private async call(
    ctx: AdapterContext,
    operation: string,
    vars: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    const ep = this.endpoint(ctx, operation);
    if (!ep) throw new Error(`Operación '${operation}' no configurada`);

    const baseUrl = (ctx.config['baseUrl'] as string ?? '').replace(/\/$/, '');
    const path = this.interpolate(ep.path as string, vars);
    const url = `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...(ctx.config['headers'] as Record<string, string> ?? {}),
      ...(ep.headers as Record<string, string> ?? {}),
    };

    this.applyAuth(headers, ctx);

    const method = (ep.method as string ?? 'GET').toUpperCase();
    const init: RequestInit = { method, headers };

    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      const template = ep.body as Record<string, unknown> | undefined;
      const payload = template
        ? this.interpolateDeep(template, vars, body)
        : (body ?? vars);
      init.body = JSON.stringify(payload);
    }

    return this.fetchWithTimeout(url, init, ctx.timeoutMs);
  }

  private applyAuth(headers: Record<string, string>, ctx: AdapterContext) {
    const auth = ctx.config['auth'] as Record<string, unknown> | undefined;
    if (!auth) return;

    const { username, password, extra } = ctx.credentials;

    switch (auth['type']) {
      case 'basic':
        if (username) {
          headers['Authorization'] =
            'Basic ' + Buffer.from(`${username}:${password ?? ''}`).toString('base64');
        }
        break;
      case 'bearer': {
        const token = (extra?.['token'] as string) ?? password;
        if (token) headers['Authorization'] = `Bearer ${token}`;
        break;
      }
      case 'apiKey': {
        const header = (auth['header'] as string) ?? 'X-API-Key';
        const key = (extra?.['apiKey'] as string) ?? password;
        if (key) headers[header] = key;
        break;
      }
      case 'custom': {
        const tpl = auth['headers'] as Record<string, string> ?? {};
        for (const [k, v] of Object.entries(tpl)) {
          headers[k] = this.interpolate(v, {
            username: username ?? '',
            password: password ?? '',
            ...(extra as Record<string, string> ?? {}),
          });
        }
        break;
      }
    }
  }

  private endpoint(ctx: AdapterContext, operation: string): Record<string, unknown> | undefined {
    const eps = ctx.config['endpoints'] as Record<string, Record<string, unknown>> | undefined;
    return eps?.[operation];
  }

  private mapping(ctx: AdapterContext, operation: string, field: string): string | undefined {
    const ep = this.endpoint(ctx, operation);
    const map = ep?.['map'] as Record<string, string> | undefined;
    return map?.[field];
  }

  /** Reemplaza {variable} en strings */
  private interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] ?? ''));
  }

  /** Igual pero recorriendo un objeto entero */
  private interpolateDeep(
    template: Record<string, unknown>,
    vars: Record<string, string>,
    items?: unknown,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      if (v === '{items}') out[k] = items;
      else if (typeof v === 'string') out[k] = this.interpolate(v, vars);
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = this.interpolateDeep(v as Record<string, unknown>, vars, items);
      } else out[k] = v;
    }
    return out;
  }

  /** Lee 'data.plan.codigo' de un objeto anidado */
  private pick(obj: unknown, path?: string): unknown {
    if (!path || obj == null) return undefined;
    return path.split('.').reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      obj,
    );
  }

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text.slice(0, 4000) };
    }
  }

  private truthy(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    if (typeof v === 'string') {
      return ['true', '1', 'si', 'sí', 'ok', 'activo', 'vigente', 'a'].includes(v.toLowerCase().trim());
    }
    return false;
  }

  private num(v: unknown): number | undefined {
    if (v == null) return undefined;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
}
