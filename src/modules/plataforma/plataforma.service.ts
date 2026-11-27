import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Servicios de la plataforma que se prenden y apagan sin publicar una versión nueva
 * (web y apps leen /api/v1/public/config al abrir).
 */
export const SERVICIOS = {
  recetas: { clave: 'servicio_recetas', nombre: 'Receta electrónica', porDefecto: false,
    detalle: 'Emisión de recetas con firma y QR. Prendelo cuando ReNaPDiS apruebe la plataforma.' },
} as const;
export type Servicio = keyof typeof SERVICIOS;

@Injectable()
export class PlataformaService {
  private cache: { at: number; valores: Record<string, string> } | null = null;
  constructor(private db: DatabaseService) {}

  private async valores(): Promise<Record<string, string>> {
    if (this.cache && Date.now() - this.cache.at < 15_000) return this.cache.valores;
    const rows = await this.db.queryMany<{ key: string; value: string }>(
      `SELECT key, value FROM platform_settings WHERE key LIKE 'servicio_%'`).catch(() => []);
    const valores = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    this.cache = { at: Date.now(), valores };
    return valores;
  }

  async activo(s: Servicio): Promise<boolean> {
    const v = (await this.valores())[SERVICIOS[s].clave];
    return v === undefined ? SERVICIOS[s].porDefecto : v === 'true';
  }

  /** Lo que ven la web y las apps */
  async publica() {
    const out: Record<string, boolean> = {};
    for (const s of Object.keys(SERVICIOS) as Servicio[]) out[s] = await this.activo(s);
    return { servicios: out };
  }

  private async exigirAdmin(doctorId?: string) {
    const a = doctorId ? await this.db.queryOne(`SELECT is_platform_admin FROM doctors WHERE id = $1`, [doctorId]) : null;
    if (!a?.is_platform_admin) throw new ForbiddenException('Solo administradores de la plataforma');
  }

  async listar(doctorId?: string) {
    await this.exigirAdmin(doctorId);
    const out = [];
    for (const [id, s] of Object.entries(SERVICIOS)) out.push({ id, nombre: s.nombre, detalle: s.detalle, activo: await this.activo(id as Servicio) });
    return out;
  }

  async cambiar(doctorId: string | undefined, s: Servicio, activo: boolean) {
    await this.exigirAdmin(doctorId);
    if (!SERVICIOS[s]) throw new ForbiddenException('Servicio desconocido');
    await this.db.query(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [SERVICIOS[s].clave, activo ? 'true' : 'false']);
    await this.db.query(
      `INSERT INTO audit_logs (doctor_id, action, entity_type, details) VALUES ($1, $2, 'platform', $3)`,
      [doctorId, activo ? 'servicio_activado' : 'servicio_desactivado', JSON.stringify({ servicio: s })]).catch(() => {});
    this.cache = null;
    return this.listar(doctorId);
  }
}
