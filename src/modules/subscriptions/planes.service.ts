import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

export type PlanId = 'gratis' | 'profesional' | 'consultorio' | 'clinica';

/**
 * Planes publicados en tusrecetasmed.com/para-medicos. waAutoMes = avisos automáticos de WhatsApp
 * (confirmación + recordatorio) por mes; -1 = sin límite. En Consultorio y Clínica el cupo es de todo el equipo.
 */
export const PLANES: Record<PlanId, { nombre: string; precio: number; waAutoMes: number; profesionales: number; mpPlan?: string }> = {
  gratis: { nombre: 'Gratis', precio: 0, waAutoMes: 200, profesionales: 1 },
  profesional: { nombre: 'Profesional', precio: 9000, waAutoMes: 1000, profesionales: 1, mpPlan: 'pro' },
  consultorio: { nombre: 'Consultorio', precio: 19000, waAutoMes: 3000, profesionales: 3, mpPlan: 'centro' },
  clinica: { nombre: 'Clínica', precio: 39000, waAutoMes: -1, profesionales: 10, mpPlan: 'clinica' },
};
const PLAN_POR_PRODUCTO: Record<string, PlanId> = { pro: 'profesional', centro: 'consultorio', centro10: 'clinica', clinica: 'clinica' };
const COMPARTIDOS = ['centro', 'centro10', 'clinica'];

/** Tipos de envío que cuentan para el cupo mensual (las respuestas a mensajes del paciente no cuentan) */
const TIPOS_CUPO = ['confirmacion', 'recordatorio'];

/**
 * Plan efectivo de cada médico: lo que pagó por Mercado Pago (o lo que le asignó un administrador),
 * o el lanzamiento (Profesional sin costo hasta PROMO_PRO_HASTA), o Gratis.
 */
@Injectable()
export class PlanesService {
  private readonly logger = new Logger(PlanesService.name);
  constructor(private db: DatabaseService, private config: ConfigService) {}

  /** Último día del lanzamiento con Profesional incluido (inclusive) */
  get promoHasta(): string {
    return this.config.get<string>('PROMO_PRO_HASTA') || '2027-03-31';
  }
  get promoVigente(): boolean {
    return new Date() <= new Date(`${this.promoHasta}T23:59:59-03:00`);
  }

  private inicioMes(): string {
    // Mes calendario en hora de Argentina
    const ar = new Date(Date.now() - 3 * 3600_000);
    return `${ar.getUTCFullYear()}-${String(ar.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00-03:00`;
  }

  /** Avisos automáticos del mes: del médico, o de todo el equipo si el plan es compartido */
  async usoWaMes(doctorIds: string[]): Promise<number> {
    const r = await this.db.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM whatsapp_envios WHERE doctor_id = ANY($1::uuid[]) AND tipo = ANY($2) AND created_at >= $3`,
      [doctorIds, TIPOS_CUPO, this.inicioMes()],
    );
    return r?.n ?? 0;
  }

  /** Médicos de las organizaciones de este médico (para los planes de equipo) */
  private async equipo(doctorId: string): Promise<string[]> {
    const rows = await this.db.query<{ doctor_id: string }>(
      `SELECT DISTINCT od2.doctor_id FROM organization_doctors od1
         JOIN organization_doctors od2 ON od2.organization_id = od1.organization_id
        WHERE od1.doctor_id = $1`, [doctorId]);
    const ids = rows.rows.map((r: any) => r.doctor_id);
    return ids.length ? ids : [doctorId];
  }

  async estado(doctorId: string) {
    // Suscripción paga vigente (Mercado Pago, tiendas o asignada a mano). Mercado Pago se cobra mes a mes:
    // si pasaron más de 5 días del fin del período sin un pago nuevo, deja de contar.
    // Suscripción propia, o la de Consultorio/Clínica que pagó otro médico del mismo equipo
    const equipo = await this.equipo(doctorId);
    const sub = await this.db.queryOne<any>(
      `SELECT id, doctor_id, status, store, store_product_id, current_period_end, cancelled_at, created_at
         FROM subscriptions
        WHERE plan = 'pro' AND status IN ('active','grace_period','pending','billing_retry')
          AND (doctor_id = $1 OR (doctor_id = ANY($2::uuid[]) AND store_product_id = ANY($3)))
        ORDER BY (status IN ('active','grace_period')) DESC, (doctor_id = $1) DESC, created_at DESC LIMIT 1`,
      [doctorId, equipo, COMPARTIDOS],
    );
    const vigente = !!sub && ['active', 'grace_period'].includes(sub.status) &&
      (!sub.current_period_end || new Date(sub.current_period_end).getTime() + 5 * 86400_000 > Date.now());
    const pagado: PlanId | null = vigente ? (PLAN_POR_PRODUCTO[String(sub.store_product_id || 'pro')] || 'profesional') : null;
    const compartido = !!pagado && COMPARTIDOS.includes(String(sub.store_product_id));

    const plan: PlanId = pagado || (this.promoVigente ? 'profesional' : 'gratis');
    const origen = pagado ? 'pago' : this.promoVigente ? 'lanzamiento' : 'gratis';
    const limite = PLANES[plan].waAutoMes;
    const usados = await this.usoWaMes(compartido ? await this.equipo(sub.doctor_id) : [doctorId]);
    return {
      plan,
      nombre: PLANES[plan].nombre,
      origen,                                   // pago | lanzamiento | gratis
      promoHasta: this.promoHasta,
      suscripcion: sub ? {
        estado: sub.status,                     // active | pending | billing_retry | grace_period
        medio: sub.store,
        plan: PLAN_POR_PRODUCTO[String(sub.store_product_id || 'pro')] || 'profesional',
        titular: sub.doctor_id === doctorId,
        vence: sub.current_period_end,
        cancelada: !!sub.cancelled_at,
      } : null,
      whatsapp: { usados, limite, restantes: limite < 0 ? null : Math.max(0, limite - usados), compartido },
      planes: Object.entries(PLANES).map(([id, p]) => ({ id, nombre: p.nombre, precio: p.precio, waAutoMes: p.waAutoMes, profesionales: p.profesionales })),
      pagosDisponibles: !!this.config.get('MP_ACCESS_TOKEN'),
    };
  }

  /** ¿Puede mandar un aviso automático más este mes? (confirmación o recordatorio) */
  async puedeEnviarWaAuto(doctorId: string | null | undefined): Promise<{ ok: boolean; usados: number; limite: number }> {
    if (!doctorId) return { ok: true, usados: 0, limite: -1 };
    const e = await this.estado(doctorId);
    const ok = e.whatsapp.limite < 0 || e.whatsapp.usados < e.whatsapp.limite;
    if (!ok) await this.avisarLimite(doctorId, e.whatsapp.limite).catch(() => {});
    return { ok, usados: e.whatsapp.usados, limite: e.whatsapp.limite };
  }

  async registrarEnvio(doctorId: string | null | undefined, tipo: string, telefono?: string | null, appointmentId?: string | null, wamid?: string | null) {
    await this.db.query(
      `INSERT INTO whatsapp_envios (doctor_id, appointment_id, tipo, telefono, wamid) VALUES ($1, $2, $3, $4, $5)`,
      [doctorId || null, appointmentId || null, tipo, telefono || null, wamid || null],
    ).catch((e) => this.logger.warn(`No se pudo registrar el envío: ${e.message}`));
  }

  /** Una sola vez por mes: aviso en la campanita cuando se alcanza el cupo */
  private async avisarLimite(doctorId: string, limite: number) {
    const ya = await this.db.queryOne(
      `SELECT 1 FROM whatsapp_envios WHERE doctor_id = $1 AND tipo = 'limite' AND created_at >= $2`, [doctorId, this.inicioMes()]);
    if (ya) return;
    await this.registrarEnvio(doctorId, 'limite');
    await this.db.query(
      `INSERT INTO inbox_notifications (recipient_type, recipient_id, title, body, category, data)
       VALUES ('doctor', $1, $2, $3, 'plan', '{"link":"/portal#plan"}')`,
      [doctorId, `Llegaste a los ${limite} avisos automáticos del mes`,
        'Los recordatorios que faltan quedan en el Dashboard para enviarlos con un toque desde tu WhatsApp. Con el plan Profesional los avisos automáticos son ilimitados.'],
    );
    this.logger.log(`Médico ${doctorId} alcanzó el cupo de ${limite} avisos automáticos`);
  }
}
