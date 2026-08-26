/**
 * Contrato del hub de integración.
 *
 * Cada obra social se conecta mediante un adaptador que implementa
 * esta interfaz. No importa si por debajo es una API REST, un portal
 * web automatizado o una cola de revisión manual: hacia arriba todos
 * exponen exactamente lo mismo.
 *
 * Agregar una obra social nueva = escribir una clase que implemente
 * InsurerAdapter y registrarla. Nada más del sistema cambia.
 */

// ─── Entrada normalizada ────────────────────────────────────

export interface AffiliateQuery {
  /** Nro de afiliado tal como figura en la credencial */
  affiliateNumber?: string;
  /** DNI sin puntos */
  documentNumber?: string;
  /** CUIL para las que lo piden */
  cuil?: string;
  /** Código de plan si el prestador lo conoce */
  planCode?: string;
}

export interface PracticeAuthorizationRequest {
  affiliate: AffiliateQuery;
  /** Código del nomenclador */
  practiceCode: string;
  /** CIE-10 */
  diagnosisCode?: string;
  diagnosis?: string;
  /** Fecha de la prestación (ISO) */
  serviceDate: string;
  quantity?: number;
  /** Matrícula del profesional que realiza */
  professionalLicense: string;
  professionalSpecialty?: string;
  notes?: string;
}

export interface BatchSubmission {
  periodYear: number;
  periodMonth: number;
  items: BatchLine[];
}

export interface BatchLine {
  serviceDate: string;
  affiliateNumber: string;
  practiceCode: string;
  quantity: number;
  amount: number;
  diagnosisCode?: string;
  authorizationCode?: string;
  professionalLicense: string;
}

// ─── Salida normalizada ─────────────────────────────────────

export type HubStatus = 'approved' | 'rejected' | 'pending' | 'error' | 'manual_review';

export interface AffiliateStatus {
  status: HubStatus;
  isValid: boolean;
  fullName?: string;
  documentNumber?: string;
  planCode?: string;
  planName?: string;
  /** Fecha hasta la que la cobertura está vigente */
  coverageUntil?: string;
  /** Carencias activas, copagos, restricciones */
  coverage?: Record<string, unknown>;
  /** Cuánto tiempo confiar en este resultado */
  cacheSeconds?: number;
  message?: string;
  raw?: unknown;
}

export interface AuthorizationResult {
  status: HubStatus;
  /** Código que después va en la factura */
  authorizationCode?: string;
  /** Monto reconocido por la obra social */
  coveredAmount?: number;
  /** Coseguro a cargo del paciente */
  coinsurance?: number;
  validUntil?: string;
  requiresPaperwork?: boolean;
  message?: string;
  raw?: unknown;
}

export interface BatchResult {
  status: HubStatus;
  batchNumber?: string;
  acceptedItems?: number;
  rejectedItems?: number;
  acceptedAmount?: number;
  /** Detalle por línea rechazada */
  rejections?: Array<{ line: number; reason: string }>;
  receiptUrl?: string;
  message?: string;
  raw?: unknown;
}

// ─── Contexto de ejecución ──────────────────────────────────

export interface AdapterContext {
  /** Credenciales del prestador ante esta obra social (ya descifradas) */
  credentials: {
    username?: string;
    password?: string;
    providerCode?: string;
    providerCuit?: string;
    extra?: Record<string, unknown>;
  };
  /** Config del conector (URLs, selectores, endpoints) */
  config: Record<string, unknown>;
  /** Para trazabilidad */
  requestId: string;
  organizationId: string;
  /** Corta la operación si tarda demasiado */
  timeoutMs: number;
}

// ─── Capacidades ────────────────────────────────────────────

export interface AdapterCapabilities {
  validateAffiliate: boolean;
  authorizePractice: boolean;
  submitBatch: boolean;
  queryBatchStatus: boolean;
}

// ─── El contrato ────────────────────────────────────────────

export abstract class InsurerAdapter {
  /** Identificador único: 'osde_api', 'swiss_portal', 'generic_manual' */
  abstract readonly key: string;

  /** Nombre legible para logs y UI */
  abstract readonly displayName: string;

  /** Qué puede hacer este adaptador */
  abstract readonly capabilities: AdapterCapabilities;

  /**
   * Verifica que las credenciales del prestador funcionen.
   * Se llama cuando el médico las carga por primera vez y
   * periódicamente para detectar contraseñas vencidas.
   */
  abstract verifyCredentials(ctx: AdapterContext): Promise<{ valid: boolean; message?: string }>;

  /** Valida que un afiliado tenga cobertura vigente */
  async validateAffiliate(
    _query: AffiliateQuery,
    _ctx: AdapterContext,
  ): Promise<AffiliateStatus> {
    return { status: 'error', isValid: false, message: 'No soportado por este conector' };
  }

  /** Pide autorización para una práctica */
  async authorizePractice(
    _req: PracticeAuthorizationRequest,
    _ctx: AdapterContext,
  ): Promise<AuthorizationResult> {
    return { status: 'error', message: 'No soportado por este conector' };
  }

  /** Presenta el lote de facturación del período */
  async submitBatch(
    _batch: BatchSubmission,
    _ctx: AdapterContext,
  ): Promise<BatchResult> {
    return { status: 'error', message: 'No soportado por este conector' };
  }

  /** Consulta cómo quedó un lote presentado */
  async queryBatchStatus(
    _batchNumber: string,
    _ctx: AdapterContext,
  ): Promise<BatchResult> {
    return { status: 'error', message: 'No soportado por este conector' };
  }

  /**
   * Chequeo de salud sin consumir cuota.
   * El orquestador lo usa para marcar conectores caídos
   * antes de mandarles tráfico real.
   */
  async healthCheck(_ctx: AdapterContext): Promise<boolean> {
    return true;
  }

  // ─── Helpers para los adaptadores concretos ───────────────

  protected normalizeDocument(doc?: string): string | undefined {
    return doc?.replace(/\D/g, '') || undefined;
  }

  protected normalizeAffiliate(num?: string): string | undefined {
    return num?.replace(/[\s-]/g, '').toUpperCase() || undefined;
  }

  /** fetch con timeout, para que un portal colgado no bloquee la cola */
  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
