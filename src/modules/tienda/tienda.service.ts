import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { EmailService } from '../email/email.service';
import { PharmacyService } from '../pharmacy/pharmacy.service';
import { WhatsappReminderService } from '../reminders/whatsapp-reminder.service';

const MP = 'https://api.mercadopago.com';
/** Comisión: las primeras 100 ventas pagas del mes no pagan; desde la 101 se cobra el 1% */
const VENTAS_SIN_COMISION = 100;
const COMISION = 0.01;
const ESTADOS_FARMACIA = ['preparando', 'listo', 'entregado', 'cancelado'];
const TEXTO_ESTADO: Record<string, string> = {
  pendiente_pago: 'Esperando el pago', pagado: 'Pago recibido', preparando: 'La farmacia lo está preparando',
  listo: 'Listo para retirar', entregado: 'Entregado', cancelado: 'Cancelado',
};

function slugify(t: string) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Tienda online de cada farmacia: catálogo (perfumería, cuidado personal y venta libre), sucursales,
 * carrito y pago con Mercado Pago directo a la cuenta de la farmacia (marketplace: TusRecetasMed solo
 * retiene la comisión). Los medicamentos bajo receta no se venden acá: van por los pedidos con receta.
 * Requiere: MP_CLIENT_ID, MP_CLIENT_SECRET (app de Mercado Pago en modo marketplace) y ENCRYPTION_KEY.
 */
@Injectable()
export class TiendaService {
  private readonly logger = new Logger('Tienda');
  constructor(private db: DatabaseService, private config: ConfigService, private email: EmailService,
    private pharmacy: PharmacyService, private wa: WhatsappReminderService) {}

  private base() { return process.env.BASE_URL || 'https://tusrecetasmed.com'; }
  private clave() { const k = this.config.get<string>('ENCRYPTION_KEY'); if (!k) throw new ServiceUnavailableException('Falta ENCRYPTION_KEY'); return k; }
  get mpDisponible() { return !!(this.config.get('MP_CLIENT_ID') && this.config.get('MP_CLIENT_SECRET') && this.config.get('ENCRYPTION_KEY')); }

  // ─── Tienda pública ───────────────────────────────────
  async publica(slug: string) {
    const t = await this.db.queryOne<any>(
      `SELECT t.pharmacy_id, t.slug, t.nombre, t.descripcion, t.logo_url, t.whatsapp, (t.mp_access_token_enc IS NOT NULL) AS cobra_online
         FROM farmacia_tiendas t JOIN pharmacies ph ON ph.id = t.pharmacy_id
        WHERE t.slug = $1 AND t.activa AND ph.is_active`, [String(slug || '').toLowerCase()]);
    if (!t) throw new NotFoundException('Tienda no encontrada');
    const sucursales = (await this.db.query<any>(
      `SELECT id, nombre, direccion, ciudad, telefono, horario FROM farmacia_sucursales WHERE pharmacy_id = $1 AND activa ORDER BY nombre`, [t.pharmacy_id])).rows;
    const productos = (await this.db.query<any>(
      `SELECT pr.id, pr.nombre, pr.descripcion, pr.categoria, pr.precio::float AS precio, pr.foto_url, pr.venta_libre,
              COALESCE((SELECT json_object_agg(s.sucursal_id, s.cantidad) FROM farmacia_stock s WHERE s.producto_id = pr.id), '{}'::json) AS stock
         FROM farmacia_productos pr WHERE pr.pharmacy_id = $1 AND pr.activo ORDER BY pr.categoria, pr.nombre LIMIT 2000`, [t.pharmacy_id])).rows;
    const { pharmacy_id, ...pub } = t;
    return { ...pub, sucursales, productos };
  }

  async crearPedido(slug: string, b: { sucursalId: string; items: { productoId: string; cantidad: number }[]; nombre: string; telefono: string; email?: string }) {
    const t = await this.db.queryOne<any>(`SELECT * FROM farmacia_tiendas WHERE slug = $1 AND activa`, [String(slug || '').toLowerCase()]);
    if (!t) throw new NotFoundException('Tienda no encontrada');
    if (!t.mp_access_token_enc) throw new BadRequestException('Esta farmacia todavía no tiene el cobro online activo');
    const suc = await this.db.queryOne<any>(`SELECT * FROM farmacia_sucursales WHERE id = $1 AND pharmacy_id = $2 AND activa`, [b.sucursalId, t.pharmacy_id]);
    if (!suc) throw new BadRequestException('Elegí la sucursal donde vas a retirar');
    const nombre = String(b.nombre || '').trim(), tel = String(b.telefono || '').replace(/[^\d+]/g, '');
    if (nombre.length < 3) throw new BadRequestException('Ingresá tu nombre');
    if (tel.replace(/\D/g, '').length < 8) throw new BadRequestException('Ingresá tu teléfono para avisarte por WhatsApp');
    const pedidos = (Array.isArray(b.items) ? b.items : []).filter((i) => i && i.productoId && Number(i.cantidad) > 0).slice(0, 50);
    if (!pedidos.length) throw new BadRequestException('El carrito está vacío');
    const ids = pedidos.map((i) => i.productoId);
    const prods = (await this.db.query<any>(
      `SELECT pr.id, pr.nombre, pr.precio::float AS precio, s.cantidad AS stock
         FROM farmacia_productos pr LEFT JOIN farmacia_stock s ON s.producto_id = pr.id AND s.sucursal_id = $3
        WHERE pr.pharmacy_id = $1 AND pr.activo AND pr.id = ANY($2::uuid[])`, [t.pharmacy_id, ids, suc.id])).rows;
    const items = pedidos.map((i) => {
      const p = prods.find((x: any) => x.id === i.productoId);
      if (!p) throw new BadRequestException('Uno de los productos ya no está disponible');
      const cantidad = Math.min(99, Math.floor(Number(i.cantidad)));
      if (p.stock != null && p.stock < cantidad) throw new BadRequestException(`No hay stock suficiente de ${p.nombre} en esa sucursal`);
      return { productoId: p.id, nombre: p.nombre, precio: p.precio, cantidad };
    });
    const total = Math.round(items.reduce((a, i) => a + i.precio * i.cantidad, 0) * 100) / 100;
    if (total <= 0) throw new BadRequestException('El total del pedido no es válido');
    const ventas = await this.db.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM tienda_pedidos WHERE pharmacy_id = $1 AND pagado_at >= date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires'`, [t.pharmacy_id]);
    const comision = (ventas?.n ?? 0) >= VENTAS_SIN_COMISION ? Math.round(total * COMISION * 100) / 100 : 0;
    const token = crypto.randomBytes(18).toString('base64url');
    const pedido = await this.db.queryOne<any>(
      `INSERT INTO tienda_pedidos (pharmacy_id, sucursal_id, token, nombre, telefono, email, items, total, comision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, numero, token`,
      [t.pharmacy_id, suc.id, token, nombre.slice(0, 150), tel.slice(0, 30), String(b.email || '').trim().slice(0, 150) || null, JSON.stringify(items), total, comision]);
    const sellerToken = await this.tokenVendedor(t);
    const seguimiento = `${this.base()}/pedido-tienda?t=${token}`;
    const r = await fetch(`${MP}/checkout/preferences`, {
      method: 'POST', headers: { Authorization: `Bearer ${sellerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((i) => ({ id: i.productoId, title: i.nombre.slice(0, 250), quantity: i.cantidad, unit_price: i.precio, currency_id: 'ARS' })),
        payer: { name: nombre, email: b.email || undefined },
        marketplace_fee: comision || undefined,
        external_reference: pedido.id,
        statement_descriptor: String(t.nombre).slice(0, 22),
        notification_url: `${this.base()}/api/v1/tienda/mp/webhook?pedido=${pedido.id}`,
        back_urls: { success: seguimiento, pending: seguimiento, failure: seguimiento },
        auto_return: 'approved',
        expires: true, expiration_date_to: new Date(Date.now() + 48 * 3600_000).toISOString(),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const pref: any = await r.json().catch(() => ({}));
    if (!r.ok || !pref.init_point) {
      this.logger.warn(`Preferencia MP rechazada: ${r.status} ${JSON.stringify(pref).slice(0, 200)}`);
      await this.db.query(`UPDATE tienda_pedidos SET estado = 'cancelado' WHERE id = $1`, [pedido.id]);
      throw new BadRequestException('No se pudo iniciar el pago. Probá de nuevo en unos minutos.');
    }
    await this.db.query(`UPDATE tienda_pedidos SET mp_preference_id = $2 WHERE id = $1`, [pedido.id, pref.id]);
    return { numero: pedido.numero, token, pagar: pref.init_point, seguimiento };
  }

  /** Notificación de Mercado Pago: se consulta el pago con el token de la farmacia y se marca pagado */
  async webhook(pedidoId: string, body: any, query: any) {
    const paymentId = String(body?.data?.id || query?.['data.id'] || (query?.topic === 'payment' ? query?.id : '') || '');
    if (!paymentId || !/^[0-9a-f-]{36}$/i.test(String(pedidoId || ''))) return { ok: true };
    const p = await this.db.queryOne<any>(
      `SELECT tp.*, t.nombre AS tienda, t.mp_access_token_enc, t.mp_refresh_token_enc, t.mp_expires_at, t.pharmacy_id AS ph
         FROM tienda_pedidos tp JOIN farmacia_tiendas t ON t.pharmacy_id = tp.pharmacy_id WHERE tp.id = $1`, [pedidoId]);
    if (!p || p.estado !== 'pendiente_pago') return { ok: true };
    const token = await this.tokenVendedor(p);
    const r = await fetch(`${MP}/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const pay: any = await r.json().catch(() => ({}));
    if (!r.ok || pay.external_reference !== p.id || pay.status !== 'approved') return { ok: true };
    if (Math.abs(Number(pay.transaction_amount) - Number(p.total)) > 0.01) { this.logger.warn(`Pedido ${p.id}: monto pagado distinto`); return { ok: true }; }
    const upd = await this.db.query(
      `UPDATE tienda_pedidos SET estado = 'pagado', mp_payment_id = $2, pagado_at = now(), updated_at = now() WHERE id = $1 AND estado = 'pendiente_pago'`, [p.id, String(pay.id)]);
    if (!upd.rowCount) return { ok: true };
    for (const i of p.items || []) {
      await this.db.query(`UPDATE farmacia_stock SET cantidad = GREATEST(0, cantidad - $3) WHERE producto_id = $1 AND sucursal_id = $2`, [i.productoId, p.sucursal_id, i.cantidad]).catch(() => undefined);
    }
    this.wa.avisoTienda(this.telefonoWa(p.telefono), 'tienda_pedido_recibido', [p.nombre.split(' ')[0], p.tienda, String(p.numero)]).catch(() => undefined);
    const ph = await this.db.queryOne<any>(`SELECT name, email FROM pharmacies WHERE id = $1`, [p.pharmacy_id]);
    if (ph?.email) this.email.send({ to: ph.email, subject: `Nueva venta online N° ${p.numero} – TusRecetasMed`,
      html: `<p>Hola ${this.esc(ph.name)}:</p><p>Entró una venta pagada por Mercado Pago ($ ${Number(p.total).toLocaleString('es-AR')}).</p><p><a href="${this.base()}/farmacia-tienda#pedidos">Ver el pedido</a> para prepararlo.</p>` }).catch(() => undefined);
    this.logger.log(`Pedido ${p.numero} pagado`);
    return { ok: true };
  }

  async seguimiento(token: string) {
    const p = await this.db.queryOne<any>(
      `SELECT tp.numero, tp.estado, tp.items, tp.total::float AS total, tp.created_at, tp.updated_at, t.nombre AS tienda, t.slug, t.whatsapp,
              s.nombre AS sucursal, s.direccion, s.ciudad, s.horario, s.telefono
         FROM tienda_pedidos tp JOIN farmacia_tiendas t ON t.pharmacy_id = tp.pharmacy_id JOIN farmacia_sucursales s ON s.id = tp.sucursal_id
        WHERE tp.token = $1`, [String(token || '')]);
    if (!p) throw new NotFoundException('Pedido no encontrado');
    return { ...p, estadoTexto: TEXTO_ESTADO[p.estado] || p.estado };
  }

  // ─── Panel de la farmacia ─────────────────────────────
  async mia(key: string) {
    const ph = await this.pharmacy.autenticar(key);
    const t = await this.db.queryOne<any>(
      `SELECT slug, nombre, descripcion, logo_url, activa, whatsapp, mp_user_id, mp_conectado_at FROM farmacia_tiendas WHERE pharmacy_id = $1`, [ph.id]);
    const sucursales = (await this.db.query<any>(`SELECT * FROM farmacia_sucursales WHERE pharmacy_id = $1 ORDER BY created_at`, [ph.id])).rows;
    const mes = await this.db.queryOne<any>(
      `SELECT count(*)::int AS ventas, COALESCE(sum(total),0)::float AS total, COALESCE(sum(comision),0)::float AS comision
         FROM tienda_pedidos WHERE pharmacy_id = $1 AND pagado_at >= date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires'`, [ph.id]);
    return {
      farmacia: { nombre: ph.name, ciudad: ph.city },
      tienda: t ? { ...t, url: `${this.base()}/f/${t.slug}`, mpConectado: !!t.mp_conectado_at } : null,
      sucursales, mes, mpDisponible: this.mpDisponible,
      comision: { ventasSinComision: VENTAS_SIN_COMISION, porcentaje: COMISION * 100 },
    };
  }

  async guardarTienda(key: string, b: { slug?: string; nombre?: string; descripcion?: string; logoUrl?: string; whatsapp?: string; activa?: boolean }) {
    const ph = await this.pharmacy.autenticar(key);
    const actual = await this.db.queryOne<any>(`SELECT slug FROM farmacia_tiendas WHERE pharmacy_id = $1`, [ph.id]);
    const slug = slugify(b.slug || actual?.slug || ph.name);
    if (slug.length < 3) throw new BadRequestException('Elegí una dirección de al menos 3 letras');
    const ocupado = await this.db.queryOne(`SELECT 1 FROM farmacia_tiendas WHERE slug = $1 AND pharmacy_id <> $2`, [slug, ph.id]);
    if (ocupado) throw new BadRequestException('Esa dirección ya la usa otra farmacia');
    const logo = String(b.logoUrl || '').trim();
    if (logo && !/^https:\/\//i.test(logo)) throw new BadRequestException('El logo tiene que ser un link https');
    await this.db.query(
      `INSERT INTO farmacia_tiendas (pharmacy_id, slug, nombre, descripcion, logo_url, whatsapp, activa)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,false))
       ON CONFLICT (pharmacy_id) DO UPDATE SET slug = EXCLUDED.slug, nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion,
         logo_url = EXCLUDED.logo_url, whatsapp = EXCLUDED.whatsapp, activa = COALESCE($7, farmacia_tiendas.activa), updated_at = now()`,
      [ph.id, slug, String(b.nombre || ph.name).trim().slice(0, 150), String(b.descripcion || '').trim().slice(0, 600) || null,
        logo || null, String(b.whatsapp || '').replace(/[^\d+]/g, '').slice(0, 30) || null, typeof b.activa === 'boolean' ? b.activa : null]);
    return this.mia(key);
  }

  async guardarSucursal(key: string, b: any) {
    const ph = await this.pharmacy.autenticar(key);
    const nombre = String(b.nombre || '').trim(), direccion = String(b.direccion || '').trim();
    if (!nombre || direccion.length < 4) throw new BadRequestException('Completá el nombre y la dirección de la sucursal');
    const vals = [nombre.slice(0, 120), direccion.slice(0, 250), String(b.ciudad || ph.city || '').slice(0, 100) || null,
      String(b.telefono || '').slice(0, 30) || null, String(b.horario || '').slice(0, 200) || null, b.activa !== false];
    if (b.id) {
      const r = await this.db.query(`UPDATE farmacia_sucursales SET nombre=$3, direccion=$4, ciudad=$5, telefono=$6, horario=$7, activa=$8 WHERE id=$1 AND pharmacy_id=$2`, [b.id, ph.id, ...vals]);
      if (!r.rowCount) throw new NotFoundException('Sucursal no encontrada');
    } else {
      await this.db.query(`INSERT INTO farmacia_sucursales (pharmacy_id, nombre, direccion, ciudad, telefono, horario, activa) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ph.id, ...vals]);
    }
    return this.mia(key);
  }

  async productos(key: string, q?: string) {
    const ph = await this.pharmacy.autenticar(key);
    const r = await this.db.query<any>(
      `SELECT pr.*, pr.precio::float AS precio,
              COALESCE((SELECT json_object_agg(s.sucursal_id, s.cantidad) FROM farmacia_stock s WHERE s.producto_id = pr.id), '{}'::json) AS stock
         FROM farmacia_productos pr WHERE pr.pharmacy_id = $1 AND ($2 = '' OR lower(pr.nombre) LIKE '%' || lower($2) || '%')
        ORDER BY pr.activo DESC, pr.categoria, pr.nombre LIMIT 500`, [ph.id, String(q || '').trim()]);
    return r.rows;
  }

  async guardarProducto(key: string, b: any) {
    const ph = await this.pharmacy.autenticar(key);
    const nombre = String(b.nombre || '').trim(); const precio = Number(String(b.precio ?? '').replace(',', '.'));
    if (nombre.length < 2) throw new BadRequestException('Ingresá el nombre del producto');
    if (!isFinite(precio) || precio <= 0) throw new BadRequestException(`Precio inválido para ${nombre}`);
    const foto = String(b.fotoUrl || '').trim();
    if (foto && !/^https:\/\//i.test(foto)) throw new BadRequestException('La foto tiene que ser un link https');
    const vals = [nombre.slice(0, 200), String(b.descripcion || '').slice(0, 1000) || null, String(b.categoria || 'Otros').trim().slice(0, 60) || 'Otros',
      Math.round(precio * 100) / 100, foto || null, String(b.codigo || '').trim().slice(0, 60) || null, !!b.ventaLibre, b.activo !== false];
    let id = b.id;
    if (id) {
      const r = await this.db.query(`UPDATE farmacia_productos SET nombre=$3, descripcion=$4, categoria=$5, precio=$6, foto_url=$7, codigo=$8, venta_libre=$9, activo=$10, updated_at=now() WHERE id=$1 AND pharmacy_id=$2`, [id, ph.id, ...vals]);
      if (!r.rowCount) throw new NotFoundException('Producto no encontrado');
    } else {
      id = (await this.db.queryOne<any>(`INSERT INTO farmacia_productos (pharmacy_id, nombre, descripcion, categoria, precio, foto_url, codigo, venta_libre, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [ph.id, ...vals])).id;
    }
    // Stock por sucursal: { sucursalId: cantidad | null }  (null o vacío = sin control de stock)
    if (b.stock && typeof b.stock === 'object') {
      for (const [sucId, cant] of Object.entries(b.stock)) {
        const ok = await this.db.queryOne(`SELECT 1 FROM farmacia_sucursales WHERE id = $1 AND pharmacy_id = $2`, [sucId, ph.id]).catch(() => null);
        if (!ok) continue;
        if (cant === null || cant === '' || cant === undefined) await this.db.query(`DELETE FROM farmacia_stock WHERE producto_id = $1 AND sucursal_id = $2`, [id, sucId]);
        else await this.db.query(`INSERT INTO farmacia_stock (producto_id, sucursal_id, cantidad) VALUES ($1,$2,$3) ON CONFLICT (producto_id, sucursal_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`, [id, sucId, Math.max(0, Math.floor(Number(cant) || 0))]);
      }
    }
    return { id };
  }

  /** Importación desde planilla: una línea por producto "nombre;precio;categoría;código" (coma o punto y coma) */
  async importar(key: string, texto: string) {
    const lineas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2000);
    let creados = 0; const errores: string[] = [];
    for (const [n, l] of lineas.entries()) {
      const c = l.includes(';') ? l.split(';') : l.split(/,(?=\s*\d)|\t/);
      if (n === 0 && /nombre/i.test(c[0] || '') && isNaN(Number(String(c[1] || '').replace(',', '.')))) continue;
      try { await this.guardarProducto(key, { nombre: c[0], precio: c[1], categoria: c[2], codigo: c[3], ventaLibre: /venta libre|otc/i.test(c[2] || '') }); creados++; }
      catch (e: any) { if (errores.length < 10) errores.push(`Línea ${n + 1}: ${e.message}`); }
    }
    return { creados, errores };
  }

  async pedidosFarmacia(key: string, abiertos = true) {
    const ph = await this.pharmacy.autenticar(key);
    const r = await this.db.query<any>(
      `SELECT tp.id, tp.numero, tp.estado, tp.nombre, tp.telefono, tp.email, tp.items, tp.total::float AS total, tp.comision::float AS comision,
              tp.created_at, tp.pagado_at, s.nombre AS sucursal
         FROM tienda_pedidos tp JOIN farmacia_sucursales s ON s.id = tp.sucursal_id
        WHERE tp.pharmacy_id = $1 AND ${abiertos ? `tp.estado IN ('pagado','preparando','listo')` : `tp.estado <> 'pendiente_pago' AND tp.created_at > now() - interval '60 days'`}
        ORDER BY tp.created_at DESC LIMIT 200`, [ph.id]);
    return r.rows;
  }

  async estadoPedido(key: string, id: string, estado: string) {
    const ph = await this.pharmacy.autenticar(key);
    if (!ESTADOS_FARMACIA.includes(estado)) throw new BadRequestException('Estado inválido');
    const p = await this.db.queryOne<any>(
      `UPDATE tienda_pedidos SET estado = $3, updated_at = now() WHERE id = $1 AND pharmacy_id = $2 AND estado IN ('pagado','preparando','listo') RETURNING *`, [id, ph.id, estado]);
    if (!p) throw new BadRequestException('El pedido ya está cerrado');
    if (estado === 'listo') {
      const info = await this.db.queryOne<any>(
        `SELECT t.nombre AS tienda, s.direccion, s.ciudad FROM farmacia_tiendas t, farmacia_sucursales s WHERE t.pharmacy_id = $1 AND s.id = $2`, [ph.id, p.sucursal_id]);
      this.wa.avisoTienda(this.telefonoWa(p.telefono), 'tienda_pedido_listo',
        [p.nombre.split(' ')[0], String(p.numero), info?.tienda || ph.name, [info?.direccion, info?.ciudad].filter(Boolean).join(', ')]).catch(() => undefined);
    }
    return { ok: true };
  }

  // ─── Mercado Pago (marketplace) ───────────────────────
  private firmar(pharmacyId: string) {
    const ts = Date.now().toString(36);
    const h = crypto.createHmac('sha256', this.clave()).update(`${pharmacyId}.${ts}`).digest('base64url').slice(0, 32);
    return `${pharmacyId}.${ts}.${h}`;
  }
  private verificarEstado(state: string) {
    const [id, ts, h] = String(state || '').split('.');
    if (!id || !ts || !h) return null;
    const ok = crypto.createHmac('sha256', this.clave()).update(`${id}.${ts}`).digest('base64url').slice(0, 32);
    if (ok !== h || Date.now() - parseInt(ts, 36) > 30 * 60_000) return null;
    return id;
  }
  private redirectUri() { return `${this.base()}/api/v1/tienda/mp/callback`; }

  async mpConectarUrl(key: string) {
    const ph = await this.pharmacy.autenticar(key);
    if (!this.mpDisponible) throw new ServiceUnavailableException('El cobro online todavía no está habilitado en TusRecetasMed. Escribinos a support@tusrecetasmed.com');
    const t = await this.db.queryOne(`SELECT 1 FROM farmacia_tiendas WHERE pharmacy_id = $1`, [ph.id]);
    if (!t) throw new BadRequestException('Primero guardá los datos de la tienda');
    const q = new URLSearchParams({ client_id: this.config.get<string>('MP_CLIENT_ID')!, response_type: 'code', platform_id: 'mp', state: this.firmar(ph.id), redirect_uri: this.redirectUri() });
    return { url: `https://auth.mercadopago.com.ar/authorization?${q}` };
  }

  async mpCallback(code: string, state: string): Promise<string> {
    const phId = this.verificarEstado(state);
    if (!phId || !code) return `${this.base()}/farmacia-tienda?mp=error`;
    const r = await fetch(`${MP}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.config.get('MP_CLIENT_ID'), client_secret: this.config.get('MP_CLIENT_SECRET'), grant_type: 'authorization_code', code, redirect_uri: this.redirectUri() }),
      signal: AbortSignal.timeout(20_000),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) { this.logger.warn(`OAuth MP rechazado: ${r.status} ${d?.message || ''}`); return `${this.base()}/farmacia-tienda?mp=error`; }
    await this.guardarTokens(phId, d);
    this.logger.log(`Farmacia ${phId} conectó Mercado Pago`);
    return `${this.base()}/farmacia-tienda?mp=ok`;
  }

  private async guardarTokens(phId: string, d: any) {
    await this.db.query(
      `UPDATE farmacia_tiendas SET mp_user_id = $2, mp_access_token_enc = pgp_sym_encrypt($3, $6), mp_refresh_token_enc = pgp_sym_encrypt($4, $6),
         mp_expires_at = now() + ($5 || ' seconds')::interval, mp_conectado_at = COALESCE(mp_conectado_at, now()), updated_at = now() WHERE pharmacy_id = $1`,
      [phId, String(d.user_id || ''), d.access_token, d.refresh_token || '', String(Number(d.expires_in) || 15552000), this.clave()]);
  }

  /** Token de la farmacia; se renueva solo si vence en menos de 7 días */
  private async tokenVendedor(t: any): Promise<string> {
    const phId = t.pharmacy_id || t.ph;
    const row = await this.db.queryOne<any>(
      `SELECT pgp_sym_decrypt(mp_access_token_enc, $2) AS at, pgp_sym_decrypt(mp_refresh_token_enc, $2) AS rt, mp_expires_at FROM farmacia_tiendas WHERE pharmacy_id = $1`, [phId, this.clave()]);
    if (!row?.at) throw new BadRequestException('La farmacia no tiene Mercado Pago conectado');
    if (row.rt && row.mp_expires_at && new Date(row.mp_expires_at).getTime() - Date.now() < 7 * 86400_000) {
      const r = await fetch(`${MP}/oauth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: this.config.get('MP_CLIENT_ID'), client_secret: this.config.get('MP_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: row.rt }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      const d: any = r ? await r.json().catch(() => ({})) : {};
      if (d?.access_token) { await this.guardarTokens(phId, d); return d.access_token; }
    }
    return row.at;
  }

  async mpDesconectar(key: string) {
    const ph = await this.pharmacy.autenticar(key);
    await this.db.query(`UPDATE farmacia_tiendas SET mp_user_id = NULL, mp_access_token_enc = NULL, mp_refresh_token_enc = NULL, mp_expires_at = NULL, mp_conectado_at = NULL WHERE pharmacy_id = $1`, [ph.id]);
    return this.mia(key);
  }

  private telefonoWa(t: string) {
    let d = String(t || '').replace(/\D/g, '').replace(/^0/, '');
    if (!d.startsWith('54')) d = '549' + d;
    else if (!d.startsWith('549')) d = '549' + d.slice(2);
    return d;
  }
  private esc(s: string) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]); }
}
