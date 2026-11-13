import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { EmailService } from '../email/email.service';
import { PharmacyService } from '../pharmacy/pharmacy.service';
import { WhatsappReminderService } from '../reminders/whatsapp-reminder.service';

const ESTADOS_FARMACIA = ['confirmado', 'listo', 'entregado', 'rechazado'] as const;
const TEXTO_ESTADO: Record<string, string> = {
  enviado: 'Enviado a la farmacia', confirmado: 'Confirmado por la farmacia', listo: 'Listo para retirar',
  entregado: 'Entregado', rechazado: 'La farmacia no puede prepararlo', cancelado: 'Cancelado',
};

/**
 * Pedidos de recetas a farmacias. El paciente (con el código de la receta y su DNI) elige una farmacia
 * habilitada; la farmacia ve el pedido en su portal, confirma stock y precio y entrega. El pago y la
 * dispensa se hacen en la farmacia, bajo control del farmacéutico (Ley 17.565): la plataforma no vende.
 */
@Injectable()
export class PedidosService {
  private readonly logger = new Logger('Pedidos');
  constructor(private db: DatabaseService, private email: EmailService, private pharmacy: PharmacyService, private wa: WhatsappReminderService) {}

  private base() { return process.env.BASE_URL || 'https://tusrecetasmed.com'; }

  /** Receta por código/CUIR exigiendo el DNI del paciente (mismo criterio que la farmacia) */
  private async receta(codigo: string, dni: string) {
    const c = String(codigo || '').trim().toUpperCase();
    const d = String(dni || '').replace(/\D/g, '');
    if (!c || d.length < 6) throw new BadRequestException('Ingresá el código de la receta y tu DNI');
    const rx = await this.db.queryOne<any>(
      `SELECT rx.id, rx.status, rx.expires_at, rx.verification_code, p.dni, p.first_name, p.last_name
         FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id
        WHERE upper(rx.verification_code) = $1 OR upper(rx.cuir) = $1`, [c]);
    if (!rx || String(rx.dni || '').replace(/\D/g, '') !== d) throw new NotFoundException('No hay una receta con ese código para ese DNI');
    if (!['active', 'partially_dispensed'].includes(rx.status) || new Date(rx.expires_at) < new Date())
      throw new BadRequestException('Esta receta ya no se puede pedir: está vencida, anulada o dispensada');
    return rx;
  }

  /** Farmacias que aceptan pedidos, filtradas por ciudad o provincia */
  async farmacias(q?: string) {
    const t = String(q || '').trim();
    const r = await this.db.query<any>(
      `SELECT id, name AS nombre, address AS direccion, city AS ciudad, province AS provincia, phone AS telefono, hace_envios, horario
         FROM pharmacies
        WHERE is_active AND acepta_pedidos
          AND ($1 = '' OR unaccent_simple(lower(city || ' ' || COALESCE(province,'') || ' ' || name)) LIKE '%' || unaccent_simple(lower($1)) || '%')
        ORDER BY (lower(city) = lower($1)) DESC, name LIMIT 50`, [t]);
    return r.rows;
  }

  async crear(b: { codigo: string; dni: string; pharmacyId: string; modalidad?: string; direccion?: string; telefono: string; notas?: string }) {
    const rx = await this.receta(b.codigo, b.dni);
    const tel = String(b.telefono || '').replace(/[^\d+]/g, '');
    if (tel.replace(/\D/g, '').length < 8) throw new BadRequestException('Ingresá un teléfono para que la farmacia te contacte');
    const ph = await this.db.queryOne<any>(`SELECT * FROM pharmacies WHERE id = $1 AND is_active AND acepta_pedidos`, [b.pharmacyId]);
    if (!ph) throw new NotFoundException('La farmacia no está recibiendo pedidos');
    const modalidad = b.modalidad === 'envio' ? 'envio' : 'retiro';
    if (modalidad === 'envio' && !ph.hace_envios) throw new BadRequestException('Esa farmacia no hace envíos: elegí retirar en el local');
    if (modalidad === 'envio' && String(b.direccion || '').trim().length < 6) throw new BadRequestException('Ingresá la dirección de entrega');
    const abierto = await this.db.queryOne(
      `SELECT 1 FROM pedidos_farmacia WHERE prescription_id = $1 AND estado IN ('enviado','confirmado','listo')`, [rx.id]);
    if (abierto) throw new BadRequestException('Ya hay un pedido en curso para esta receta. Cancelalo para pedir en otra farmacia.');
    const token = crypto.randomBytes(18).toString('base64url');
    const p = await this.db.queryOne<any>(
      `INSERT INTO pedidos_farmacia (prescription_id, pharmacy_id, token, modalidad, direccion, telefono, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, token, estado, created_at`,
      [rx.id, ph.id, token, modalidad, modalidad === 'envio' ? String(b.direccion).trim().slice(0, 300) : null, tel.slice(0, 30), String(b.notas || '').trim().slice(0, 500) || null]);
    if (ph.email) {
      this.email.send({
        to: ph.email, subject: 'Nuevo pedido de receta – TusRecetasMed',
        html: `<p>Hola ${this.esc(ph.name)}:</p><p>Un paciente te envió una receta para ${modalidad === 'envio' ? 'envío a domicilio' : 'retirar en la farmacia'}.</p>
               <p><a href="${this.base()}/farmacia#pedidos">Ver el pedido</a> para confirmar stock y precio.</p><p>TusRecetasMed</p>`,
      }).catch(() => undefined);
    }
    this.logger.log(`Pedido ${p.id} a la farmacia ${ph.id}`);
    return { ...p, seguimiento: `${this.base()}/pedido?t=${token}` };
  }

  private esc(s: string) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]); }

  /** Seguimiento del pedido para el paciente (con el token del link) */
  async seguimiento(token: string) {
    const p = await this.db.queryOne<any>(
      `SELECT pf.id, pf.estado, pf.modalidad, pf.direccion, pf.total, pf.mensaje_farmacia, pf.created_at, pf.updated_at,
              ph.name AS farmacia, ph.address AS farmacia_direccion, ph.city AS farmacia_ciudad, ph.phone AS farmacia_telefono, ph.horario,
              rx.verification_code AS codigo
         FROM pedidos_farmacia pf JOIN pharmacies ph ON ph.id = pf.pharmacy_id JOIN prescriptions rx ON rx.id = pf.prescription_id
        WHERE pf.token = $1`, [String(token || '')]);
    if (!p) throw new NotFoundException('Pedido no encontrado');
    return { ...p, estadoTexto: TEXTO_ESTADO[p.estado] || p.estado };
  }

  async cancelar(token: string) {
    const r = await this.db.query(
      `UPDATE pedidos_farmacia SET estado = 'cancelado', updated_at = now() WHERE token = $1 AND estado IN ('enviado','confirmado','listo')`, [String(token || '')]);
    if (!r.rowCount) throw new BadRequestException('El pedido ya no se puede cancelar');
    return { ok: true };
  }

  // ─── Portal de la farmacia ────────────────────────────
  async listarFarmacia(key: string, estado?: string) {
    const ph = await this.pharmacy.autenticar(key);
    const abiertos = !estado || estado === 'abiertos';
    const r = await this.db.query<any>(
      `SELECT pf.id, pf.estado, pf.modalidad, pf.direccion, pf.telefono, pf.notas, pf.total, pf.mensaje_farmacia, pf.created_at,
              rx.verification_code AS codigo, rx.cuir, p.first_name || ' ' || p.last_name AS paciente, p.dni,
              p.insurance_provider AS cobertura, p.insurance_number AS afiliado,
              (SELECT json_agg(json_build_object('nombre', COALESCE(i.generic_name, i.medication_name), 'marca', i.medication_name,
                      'presentacion', i.presentation, 'cantidad', i.quantity) ORDER BY i.created_at)
                 FROM prescription_items i WHERE i.prescription_id = rx.id) AS items
         FROM pedidos_farmacia pf JOIN prescriptions rx ON rx.id = pf.prescription_id JOIN patients p ON p.id = rx.patient_id
        WHERE pf.pharmacy_id = $1 AND (${abiertos ? `pf.estado IN ('enviado','confirmado','listo')` : `pf.created_at > now() - interval '60 days'`})
        ORDER BY pf.created_at DESC LIMIT 100`, [ph.id]);
    return { farmacia: { aceptaPedidos: ph.acepta_pedidos, haceEnvios: ph.hace_envios, horario: ph.horario }, pedidos: r.rows };
  }

  async actualizarFarmacia(key: string, id: string, b: { estado: string; total?: number; mensaje?: string }) {
    const ph = await this.pharmacy.autenticar(key);
    if (!(ESTADOS_FARMACIA as readonly string[]).includes(b.estado)) throw new BadRequestException('Estado inválido');
    const total = b.total == null || (b.total as any) === '' ? null : Number(b.total);
    if (total != null && (!isFinite(total) || total < 0)) throw new BadRequestException('Precio inválido');
    const r = await this.db.query(
      `UPDATE pedidos_farmacia SET estado = $3, total = COALESCE($4, total), mensaje_farmacia = COALESCE($5, mensaje_farmacia), updated_at = now()
        WHERE id = $1 AND pharmacy_id = $2 AND estado NOT IN ('entregado','cancelado') RETURNING id`,
      [id, ph.id, b.estado, total, b.mensaje ? String(b.mensaje).slice(0, 500) : null]);
    if (!r.rowCount) throw new BadRequestException('El pedido ya está cerrado o no es de esta farmacia');
    if (b.estado === 'listo') {
      const p = await this.db.queryOne<any>(
        `SELECT pf.telefono, pf.modalidad, rx.verification_code AS codigo, pa.first_name FROM pedidos_farmacia pf
           JOIN prescriptions rx ON rx.id = pf.prescription_id JOIN patients pa ON pa.id = rx.patient_id WHERE pf.id = $1`, [id]);
      if (p && p.modalidad === 'retiro') {
        let tel = String(p.telefono || '').replace(/\D/g, '').replace(/^0/, '');
        tel = tel.startsWith('549') ? tel : tel.startsWith('54') ? '549' + tel.slice(2) : '549' + tel;
        this.wa.avisoTienda(tel, 'tienda_pedido_listo', [p.first_name || 'Hola', p.codigo, ph.name, [ph.address, ph.city].filter(Boolean).join(', ')]).catch(() => undefined);
      }
    }
    return { ok: true };
  }

  async configurar(key: string, b: { aceptaPedidos?: boolean; haceEnvios?: boolean; horario?: string }) {
    const ph = await this.pharmacy.autenticar(key);
    await this.db.query(
      `UPDATE pharmacies SET acepta_pedidos = COALESCE($2, acepta_pedidos), hace_envios = COALESCE($3, hace_envios), horario = COALESCE($4, horario) WHERE id = $1`,
      [ph.id, typeof b.aceptaPedidos === 'boolean' ? b.aceptaPedidos : null, typeof b.haceEnvios === 'boolean' ? b.haceEnvios : null,
        b.horario != null ? String(b.horario).slice(0, 200) : null]);
    return { ok: true };
  }
}
