import { Injectable, Logger } from '@nestjs/common';
import {
  InsurerAdapter, AdapterContext, AdapterCapabilities,
  AffiliateQuery, AffiliateStatus,
  PracticeAuthorizationRequest, AuthorizationResult,
  BatchSubmission, BatchResult,
} from './adapter.interface';
import { DatabaseService } from '../../../database/database.service';

/**
 * Adaptador de resolución manual.
 *
 * Es el fallback universal: cuando una obra social no tiene API ni
 * portal automatizable, la operación entra en una cola que resuelve
 * un operador humano (nuestro o del propio consultorio).
 *
 * Por qué importa: para el prestador la experiencia es idéntica.
 * Llama al mismo endpoint, recibe la misma estructura de respuesta.
 * La única diferencia es que el status vuelve 'manual_review' y el
 * resultado final llega por webhook o polling minutos después.
 *
 * Esto nos deja arrancar con cobertura nacional completa y después ir
 * reemplazando adaptadores manuales por automáticos sin que ningún
 * consultorio tenga que cambiar una línea de su integración.
 */
@Injectable()
export class ManualAdapter extends InsurerAdapter {
  readonly key = 'generic_manual';
  readonly displayName = 'Resolución manual';
  readonly capabilities: AdapterCapabilities = {
    validateAffiliate: true,
    authorizePractice: true,
    submitBatch: true,
    queryBatchStatus: true,
  };

  private readonly logger = new Logger(ManualAdapter.name);

  constructor(private db: DatabaseService) {
    super();
  }

  async verifyCredentials(): Promise<{ valid: boolean; message?: string }> {
    // No hay nada que verificar: la resuelve una persona
    return { valid: true };
  }

  async validateAffiliate(query: AffiliateQuery, ctx: AdapterContext): Promise<AffiliateStatus> {
    // Antes de encolar, buscamos en el histórico. Si este afiliado ya
    // fue validado alguna vez, lo más probable es que siga vigente.
    const known = await this.lookupHistory(query, ctx);
    if (known) {
      return {
        status: 'approved',
        isValid: true,
        fullName: known.full_name,
        planCode: known.plan_code,
        planName: known.plan_name,
        cacheSeconds: 3600,
        message: 'Datos de validación previa. Confirmar en mostrador.',
      };
    }

    await this.enqueue(ctx, 'validate', query);

    return {
      status: 'manual_review',
      isValid: false,
      message: 'Sin integración automática. Verificar credencial del paciente en el consultorio.',
      cacheSeconds: 0,
    };
  }

  async authorizePractice(
    req: PracticeAuthorizationRequest,
    ctx: AdapterContext,
  ): Promise<AuthorizationResult> {
    const taskId = await this.enqueue(ctx, 'authorize', req);

    return {
      status: 'manual_review',
      requiresPaperwork: true,
      message: 'Esta obra social requiere gestión manual de la autorización.',
      raw: { taskId },
    };
  }

  async submitBatch(batch: BatchSubmission, ctx: AdapterContext): Promise<BatchResult> {
    const taskId = await this.enqueue(ctx, 'submit_batch', {
      periodYear: batch.periodYear,
      periodMonth: batch.periodMonth,
      itemCount: batch.items.length,
      totalAmount: batch.items.reduce((sum, i) => sum + (i.amount ?? 0), 0),
    });

    return {
      status: 'manual_review',
      message: 'Lote generado. Se presenta por el circuito habitual de la obra social.',
      raw: { taskId },
    };
  }

  async queryBatchStatus(batchNumber: string, ctx: AdapterContext): Promise<BatchResult> {
    const batch = await this.db.queryOne(
      `SELECT status, total_items, total_amount, accepted_amount, rejected_amount
       FROM billing_batches
       WHERE batch_number = $1 AND organization_id = $2`,
      [batchNumber, ctx.organizationId],
    );

    if (!batch) {
      return { status: 'error', message: 'Lote no encontrado' };
    }

    return {
      status: batch.status === 'accepted' ? 'approved'
            : batch.status === 'rejected' ? 'rejected'
            : 'pending',
      batchNumber,
      acceptedItems: batch.total_items,
      acceptedAmount: batch.accepted_amount ? Number(batch.accepted_amount) : undefined,
    };
  }

  // ─── Internas ─────────────────────────────────────────────

  /**
   * Busca si este afiliado ya fue validado antes por cualquier
   * consultorio de la red. El dato es del padrón, no del prestador,
   * así que es reutilizable.
   */
  private async lookupHistory(query: AffiliateQuery, ctx: AdapterContext) {
    const affiliate = this.normalizeAffiliate(query.affiliateNumber);
    const doc = this.normalizeDocument(query.documentNumber);
    if (!affiliate && !doc) return null;

    const insurerId = ctx.config['insurerId'] as string;
    if (!insurerId) return null;

    return this.db.queryOne(
      `SELECT full_name, plan_code, plan_name
       FROM affiliate_cache
       WHERE insurer_id = $1
         AND is_valid = true
         AND (affiliate_number = $2 OR document_number = $3)
       ORDER BY validated_at DESC
       LIMIT 1`,
      [insurerId, affiliate ?? '', doc ?? ''],
    );
  }

  /** Deja la operación en la cola de resolución humana */
  private async enqueue(
    ctx: AdapterContext,
    operation: string,
    payload: unknown,
  ): Promise<string> {
    const row = await this.db.queryOne<{ id: string }>(
      `UPDATE hub_requests
       SET result = 'manual_review',
           response = $1,
           completed_at = NULL
       WHERE id = $2
       RETURNING id`,
      [JSON.stringify({ queuedAt: new Date().toISOString(), operation, payload }), ctx.requestId],
    );

    this.logger.log(`Encolado para revisión manual: ${operation} [${ctx.requestId}]`);
    return row?.id ?? ctx.requestId;
  }
}
