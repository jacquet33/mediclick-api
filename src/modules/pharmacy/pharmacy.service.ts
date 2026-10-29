import { Injectable, BadRequestException, NotFoundException, ForbiddenException, UnauthorizedException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { PrescriptionSigningService } from '../prescriptions/prescription-signing.service';
import { DigitalSignatureService } from '../prescriptions/digital-signature.service';

/**
 * Repositorio de recetas para farmacias (Ley 27.553): cada farmacia habilitada accede con su clave,
 * solo a la receta que está dispensando (código/CUIR + DNI del paciente), y registra la dispensa.
 */
@Injectable()
export class PharmacyService {
  private readonly logger = new Logger(PharmacyService.name);
  constructor(private db: DatabaseService, private signing: PrescriptionSigningService, private digital: DigitalSignatureService) {}

  private static hash(k: string) { return crypto.createHash('sha256').update(k).digest('hex'); }

  // ─── Autenticación de la farmacia ──────────────────────
  async autenticar(key?: string) {
    const k = String(key || '').trim();
    if (!/^tco_ph_[A-Za-z0-9_-]{20,}$/.test(k)) throw new UnauthorizedException('Clave de farmacia inválida');
    const ph = await this.db.queryOne(`SELECT * FROM pharmacies WHERE api_key_hash = $1 AND is_active = true`, [PharmacyService.hash(k)]);
    if (!ph) throw new UnauthorizedException('Clave de farmacia inválida o farmacia deshabilitada');
    this.db.query(`UPDATE pharmacies SET last_used_at = NOW() WHERE id = $1`, [ph.id]).catch(() => undefined);
    return ph;
  }

  private log(pharmacyId: string, prescriptionId: string | null, action: string, ip?: string) {
    this.db.query(`INSERT INTO pharmacy_access_log (pharmacy_id, prescription_id, action, ip) VALUES ($1,$2,$3,$4)`,
      [pharmacyId, prescriptionId, action, ip || null]).catch(() => undefined);
  }

  /** Busca la receta por código de verificación o CUIR, y exige que el DNI sea el del paciente */
  private async receta(codigo: string, dni: string) {
    const c = String(codigo || '').trim().toUpperCase();
    const d = String(dni || '').replace(/\D/g, '');
    if (!c || d.length < 6) throw new BadRequestException('Ingresá el código de la receta y el DNI del paciente');
    const rx = await this.db.queryOne(
      `SELECT rx.*, p.first_name AS p_fn, p.last_name AS p_ln, p.dni AS p_dni, p.date_of_birth, p.gender,
              p.insurance_provider, p.insurance_plan, p.insurance_number,
              d.first_name AS d_fn, d.last_name AS d_ln, d.medical_license, d.license_type, d.medical_license_province,
              d.specialty, COALESCE(d.license_status, 'unverified') AS license_status,
              o.name AS org_name, o.address AS org_address, o.phone AS org_phone
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       JOIN doctors d ON d.id = rx.doctor_id
       JOIN organizations o ON o.id = rx.organization_id
       WHERE upper(rx.verification_code) = $1 OR upper(rx.cuir) = $1
          OR rx.id = (SELECT prescription_id FROM prescription_items WHERE cuir = $1 LIMIT 1)`,
      [c],
    );
    // Mismo mensaje si no existe o si el DNI no coincide (no revela si la receta existe)
    if (!rx || String(rx.p_dni || '').replace(/\D/g, '') !== d) throw new NotFoundException('No hay una receta con ese código para ese DNI');
    return rx;
  }

  async consultar(key: string, codigo: string, dni: string, ip?: string) {
    const ph = await this.autenticar(key);
    const rx = await this.receta(codigo, dni);
    this.log(ph.id, rx.id, 'consulta', ip);
    const items = await this.db.queryMany(
      `SELECT id, generic_name, medication_name, pharmaceutical_form, presentation, dosage, frequency, duration,
              COALESCE(quantity, 1) AS quantity, COALESCE(dispensed_quantity, 0) AS dispensed_quantity, instructions
       FROM prescription_items WHERE prescription_id = $1 ORDER BY sort_order, created_at`,
      [rx.id],
    );
    const [firma, firmaDigital, dispensas] = await Promise.all([
      this.signing.verificar(rx.id).catch(() => null),
      this.digital.verificarReceta(rx.id).catch(() => ({ firmada: false })),
      this.db.queryMany(
        `SELECT d.created_at, d.items, d.pharmacist_name, ph.name AS farmacia FROM prescription_dispensations d
         JOIN pharmacies ph ON ph.id = d.pharmacy_id WHERE d.prescription_id = $1 ORDER BY d.created_at`, [rx.id]),
    ]);
    const vencida = rx.expires_at && new Date(rx.expires_at) < new Date();
    const dispensable = ['active', 'partially_dispensed'].includes(rx.status) && !vencida && rx.license_status === 'verified' && firma?.valida !== false;
    return {
      codigo: rx.verification_code, cuir: rx.cuir, estado: vencida && rx.status === 'active' ? 'expired' : rx.status,
      emitida: rx.issued_at, vence: rx.expires_at, dispensable,
      motivoNoDispensable: dispensable ? null
        : rx.status === 'cancelled' ? 'Receta anulada por el médico'
        : rx.status === 'dispensed' ? 'Receta ya dispensada'
        : vencida ? 'Receta vencida'
        : rx.license_status !== 'verified' ? 'El médico no tiene la matrícula verificada'
        : 'La firma de la receta no es válida',
      paciente: {
        nombre: `${rx.p_fn} ${rx.p_ln}`, dni: rx.p_dni, nacimiento: rx.date_of_birth, sexo: rx.gender,
        cobertura: rx.insurance_provider, plan: rx.insurance_plan, afiliado: rx.insurance_number,
      },
      prescriptor: {
        nombre: `${rx.d_fn} ${rx.d_ln}`, matricula: rx.medical_license, tipo: rx.license_type, provincia: rx.medical_license_province,
        especialidad: rx.specialty, matriculaVerificada: rx.license_status === 'verified',
      },
      establecimiento: { nombre: rx.org_name, direccion: rx.org_address, telefono: rx.org_phone },
      diagnostico: rx.diagnosis, cie10: rx.diagnosis_code, notas: rx.notes,
      items: items.map((i) => ({ ...i, pendiente: Math.max(0, i.quantity - i.dispensed_quantity) })),
      firmaElectronica: firma, firmaDigital, dispensas,
    };
  }

  async fhir(key: string, codigo: string, dni: string, fhir: any, ip?: string) {
    const ph = await this.autenticar(key);
    const rx = await this.receta(codigo, dni);
    this.log(ph.id, rx.id, 'consulta_fhir', ip);
    return fhir.bundle(rx.id);
  }

  async dispensar(key: string, codigo: string, body: { dni: string; items: { itemId: string; cantidad: number; producto?: string; lote?: string; vencimiento?: string }[]; farmaceutico?: string; notas?: string }, ip?: string) {
    const ph = await this.autenticar(key);
    // Una farmacia autorregistrada puede consultar, pero no marcar dispensas hasta que la revisemos
    if (ph.self_registered && !ph.reviewed) throw new ForbiddenException('Tu farmacia está en revisión: mientras tanto podés consultar recetas, pero todavía no registrar dispensas. Te avisamos por email cuando quede habilitada.');
    const rx = await this.receta(codigo, body.dni);
    const vencida = rx.expires_at && new Date(rx.expires_at) < new Date();
    if (!['active', 'partially_dispensed'].includes(rx.status) || vencida) throw new BadRequestException('La receta no se puede dispensar (anulada, vencida o ya dispensada)');
    if (rx.license_status !== 'verified') throw new ForbiddenException('El médico no tiene la matrícula verificada');
    const firma = await this.signing.verificar(rx.id).catch(() => null);
    if (firma && firma.firmada && !firma.valida) throw new ForbiddenException('La firma de la receta no es válida');
    const pedidos = (body.items || []).filter((i) => i && i.itemId && Number(i.cantidad) > 0);
    if (!pedidos.length) throw new BadRequestException('Indicá qué medicamentos y cuántas unidades se entregan');

    return this.db.transaction(async (client) => {
      const r = await client.query(
        `SELECT id, COALESCE(quantity, 1) AS quantity, COALESCE(dispensed_quantity, 0) AS dispensed
         FROM prescription_items WHERE prescription_id = $1 FOR UPDATE`, [rx.id]);
      const mapa = new Map(r.rows.map((x: any) => [x.id, x]));
      for (const p of pedidos) {
        const it: any = mapa.get(p.itemId);
        if (!it) throw new BadRequestException('Medicamento que no pertenece a la receta');
        const cant = Math.floor(Number(p.cantidad));
        if (cant > it.quantity - it.dispensed) throw new BadRequestException(`Se quiere entregar más de lo recetado (quedan ${it.quantity - it.dispensed})`);
        await client.query(`UPDATE prescription_items SET dispensed_quantity = COALESCE(dispensed_quantity, 0) + $2 WHERE id = $1`, [p.itemId, cant]);
        it.dispensed += cant;
      }
      const completo = [...mapa.values()].every((x: any) => x.dispensed >= x.quantity);
      await client.query(`UPDATE prescriptions SET status = $2::text::prescription_status, updated_at = NOW() WHERE id = $1`,
        [rx.id, completo ? 'dispensed' : 'partially_dispensed']);
      await client.query(
        `INSERT INTO prescription_dispensations (prescription_id, pharmacy_id, items, pharmacist_name, notes) VALUES ($1,$2,$3,$4,$5)`,
        [rx.id, ph.id, JSON.stringify(pedidos.map((p) => ({ itemId: p.itemId, cantidad: Math.floor(Number(p.cantidad)), producto: p.producto || null, lote: p.lote || null, vencimiento: p.vencimiento || null }))),
         body.farmaceutico || ph.pharmacist_name || null, body.notas || null],
      );
      this.log(ph.id, rx.id, completo ? 'dispensa_total' : 'dispensa_parcial', ip);
      this.logger.log(`Receta ${rx.verification_code} dispensada (${completo ? 'total' : 'parcial'}) por ${ph.name}`);
      return { ok: true, estado: completo ? 'dispensed' : 'partially_dispensed' };
    });
  }

  // ─── Registro abierto: cualquier farmacia habilitada (Ley 27.553, art. 4 Dto. 98/23) ───
  static cuitValido(c: string) {
    const d = String(c || '').replace(/\D/g, '');
    if (d.length !== 11) return false;
    const m = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const s = m.reduce((a, x, i) => a + x * +d[i], 0);
    let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) v = 9;
    return v === +d[10];
  }

  async registroPublico(dto: any, ip?: string) {
    const req = (k: string, msg: string) => { if (!String(dto[k] || '').trim()) throw new BadRequestException(msg); };
    req('name', 'Ingresá el nombre de la farmacia');
    req('habilitacion', 'Ingresá el número de habilitación de la farmacia');
    req('pharmacistName', 'Ingresá el nombre del farmacéutico/a director/a técnico/a');
    req('pharmacistLicense', 'Ingresá la matrícula del farmacéutico/a');
    req('address', 'Ingresá la dirección'); req('city', 'Ingresá la ciudad'); req('province', 'Elegí la provincia');
    if (!PharmacyService.cuitValido(dto.cuit)) throw new BadRequestException('CUIT inválido');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(dto.email || ''))) throw new BadRequestException('Email inválido');
    const cuit = String(dto.cuit).replace(/\D/g, '');
    const ya = await this.db.queryOne(`SELECT id FROM pharmacies WHERE regexp_replace(COALESCE(cuit,''), '\\D', '', 'g') = $1 AND habilitacion = $2`, [cuit, String(dto.habilitacion).trim()]);
    if (ya) throw new BadRequestException('Esa farmacia ya está registrada. Si perdiste la clave escribinos a contact@rispy.io');
    const k = this.nuevaClave();
    const ph = await this.db.queryOne(
      `INSERT INTO pharmacies (name, cuit, habilitacion, pharmacist_name, pharmacist_license, email, phone, address, city, province,
                               api_key_hash, api_key_prefix, self_registered, reviewed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,false) RETURNING id, name`,
      [String(dto.name).trim(), cuit, String(dto.habilitacion).trim(), String(dto.pharmacistName).trim(), String(dto.pharmacistLicense).trim(),
       String(dto.email).trim().toLowerCase(), dto.phone || null, String(dto.address).trim(), String(dto.city).trim(), dto.province, k.hash, k.prefix],
    );
    this.log(ph.id, null, 'registro', ip);
    this.logger.log(`Farmacia registrada: ${ph.name} (${cuit})`);
    return { ...ph, apiKey: k.key };
  }

  // ─── Administración (administrador de la plataforma) ───
  private async mustAdmin(doctorId: string) {
    const a = await this.db.queryOne(`SELECT is_platform_admin FROM doctors WHERE id = $1`, [doctorId]);
    if (!a?.is_platform_admin) throw new ForbiddenException('Solo administradores de la plataforma');
  }

  private nuevaClave() {
    const key = 'tco_ph_' + crypto.randomBytes(24).toString('base64url');
    return { key, hash: PharmacyService.hash(key), prefix: key.slice(0, 12) };
  }

  async listar(adminId: string) {
    await this.mustAdmin(adminId);
    return this.db.queryMany(
      `SELECT ph.id, ph.name, ph.cuit, ph.habilitacion, ph.pharmacist_name, ph.pharmacist_license, ph.email, ph.phone,
              ph.address, ph.city, ph.province, ph.api_key_prefix, ph.is_active, ph.created_at, ph.last_used_at, ph.self_registered, ph.reviewed,
              (SELECT COUNT(*)::int FROM prescription_dispensations d WHERE d.pharmacy_id = ph.id) AS dispensas
       FROM pharmacies ph ORDER BY ph.created_at DESC`);
  }

  async crear(adminId: string, dto: any) {
    await this.mustAdmin(adminId);
    if (!String(dto.name || '').trim()) throw new BadRequestException('Nombre de la farmacia obligatorio');
    const k = this.nuevaClave();
    const ph = await this.db.queryOne(
      `INSERT INTO pharmacies (name, cuit, habilitacion, pharmacist_name, pharmacist_license, email, phone, address, city, province, api_key_hash, api_key_prefix)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, name`,
      [dto.name.trim(), dto.cuit || null, dto.habilitacion || null, dto.pharmacistName || null, dto.pharmacistLicense || null,
       dto.email || null, dto.phone || null, dto.address || null, dto.city || null, dto.province || null, k.hash, k.prefix],
    );
    return { ...ph, apiKey: k.key };
  }

  async regenerar(adminId: string, id: string) {
    await this.mustAdmin(adminId);
    const k = this.nuevaClave();
    const r = await this.db.queryOne(`UPDATE pharmacies SET api_key_hash = $2, api_key_prefix = $3 WHERE id = $1 RETURNING id, name`, [id, k.hash, k.prefix]);
    if (!r) throw new NotFoundException('Farmacia no encontrada');
    return { ...r, apiKey: k.key };
  }

  async activar(adminId: string, id: string, activo: boolean) {
    await this.mustAdmin(adminId);
    // Activarla desde el panel equivale a revisarla (habilita registrar dispensas)
    await this.db.query(`UPDATE pharmacies SET is_active = $2, reviewed = (reviewed OR $2) WHERE id = $1`, [id, activo]);
    return { ok: true };
  }
}
