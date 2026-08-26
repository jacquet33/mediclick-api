import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { NomenclatorService } from '../nomenclators/nomenclator.service';

export interface BuildBatchDto {
  insurerId: string;
  periodYear: number;
  periodMonth: number;
  /** Si no se pasa, toma todos los turnos completados del período */
  appointmentIds?: string[];
}

export interface AddItemDto {
  patientId: string;
  appointmentId?: string;
  medicalRecordId?: string;
  doctorId: string;
  serviceDate: string;
  nomenclatorCode: string;
  quantity?: number;
  diagnosisCode?: string;
  authorizationCode?: string;
}

type AuditStatus = 'ok' | 'warning' | 'blocked';

interface AuditFinding {
  status: AuditStatus;
  note: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private db: DatabaseService,
    private nomenclators: NomenclatorService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // ARMADO DEL LOTE
  // ═══════════════════════════════════════════════════════════

  /**
   * Arma el lote del período a partir de los turnos completados.
   *
   * Toma cada consulta atendida de esa obra social en el mes, busca
   * el código y el valor en el nomenclador vigente a la fecha de la
   * prestación, y arma la línea. Después audita todo.
   */
  async buildBatch(orgId: string, dto: BuildBatchDto) {
    const insurer = await this.db.queryOne(
      `SELECT * FROM insurers WHERE id = $1`, [dto.insurerId],
    );
    if (!insurer) throw new NotFoundException('Financiador no encontrado');

    // Un solo lote por período y financiador
    const existing = await this.db.queryOne(
      `SELECT id, status FROM billing_batches
       WHERE organization_id = $1 AND insurer_id = $2
         AND period_year = $3 AND period_month = $4`,
      [orgId, dto.insurerId, dto.periodYear, dto.periodMonth],
    );

    if (existing && existing.status !== 'draft') {
      throw new BadRequestException(
        `Ya existe un lote de ${dto.periodMonth}/${dto.periodYear} en estado "${existing.status}"`,
      );
    }

    const batchId = existing?.id ?? (await this.db.queryOne(
      `INSERT INTO billing_batches (organization_id, insurer_id, period_year, period_month)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [orgId, dto.insurerId, dto.periodYear, dto.periodMonth],
    )).id;

    // Limpiar el borrador para rearmarlo
    await this.db.query(`DELETE FROM billing_items WHERE batch_id = $1`, [batchId]);

    // Traer los turnos facturables del período
    const from = `${dto.periodYear}-${String(dto.periodMonth).padStart(2, '0')}-01`;
    const to = new Date(dto.periodYear, dto.periodMonth, 0).toISOString().slice(0, 10);

    let apptFilter = '';
    const params: unknown[] = [orgId, dto.insurerId, from, to];
    if (dto.appointmentIds?.length) {
      apptFilter = ` AND a.id = ANY($5::uuid[])`;
      params.push(dto.appointmentIds);
    }

    const appointments = await this.db.queryMany(
      `SELECT a.id AS appointment_id, a.date AS service_date,
              p.id AS patient_id, p.first_name, p.last_name,
              p.date_of_birth, p.gender, p.insurance_number, p.insurance_plan,
              od.doctor_id,
              mr.id AS medical_record_id, mr.diagnosis_code, mr.diagnosis
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN organization_doctors od ON od.id = a.org_doctor_id
       LEFT JOIN medical_records mr ON mr.appointment_id = a.id
       LEFT JOIN insurers i ON LOWER(p.insurance_provider) = LOWER(i.name)
       WHERE a.organization_id = $1
         AND a.status = 'completed'
         AND i.id = $2
         AND a.date BETWEEN $3::date AND $4::date
         ${apptFilter}
       ORDER BY a.date, a.start_time`,
      params,
    );

    // Código de consulta por defecto de la organización
    const defaultCode = await this.defaultConsultationCode(orgId, dto.insurerId);

    let added = 0;
    const skipped: string[] = [];

    for (const appt of appointments) {
      const code = defaultCode;
      if (!code) {
        skipped.push(`${appt.first_name} ${appt.last_name}: sin código de consulta configurado`);
        continue;
      }

      await this.addItem(orgId, batchId, {
        patientId: appt.patient_id,
        appointmentId: appt.appointment_id,
        medicalRecordId: appt.medical_record_id,
        doctorId: appt.doctor_id,
        serviceDate: appt.service_date.toISOString?.().slice(0, 10) ?? String(appt.service_date),
        nomenclatorCode: code,
        diagnosisCode: appt.diagnosis_code,
      }, { skipAudit: true });

      added++;
    }

    // Auditar todo el lote junto (algunas reglas son de conjunto)
    const audit = await this.auditBatch(orgId, batchId);
    await this.recalcTotals(batchId);

    return {
      batchId,
      appointmentsFound: appointments.length,
      itemsAdded: added,
      skipped,
      audit,
    };
  }

  /** Agrega una línea al lote, valorizándola con el nomenclador vigente */
  async addItem(
    orgId: string,
    batchId: string,
    dto: AddItemDto,
    opts: { skipAudit?: boolean } = {},
  ) {
    const batch = await this.db.queryOne(
      `SELECT * FROM billing_batches WHERE id = $1 AND organization_id = $2`,
      [batchId, orgId],
    );
    if (!batch) throw new NotFoundException('Lote no encontrado');
    if (batch.status !== 'draft') {
      throw new BadRequestException('El lote ya fue presentado, no se puede modificar');
    }

    const patient = await this.db.queryOne(
      `SELECT * FROM patients WHERE id = $1 AND organization_id = $2`,
      [dto.patientId, orgId],
    );
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    // Valorizar con el nomenclador vigente a la fecha de la prestación
    const item = await this.nomenclators.lookupCode(
      batch.insurer_id, dto.nomenclatorCode, dto.serviceDate, orgId,
    );

    const quantity = dto.quantity ?? 1;
    const unitAmount = item ? this.valorize(item) : 0;

    const row = await this.db.queryOne(
      `INSERT INTO billing_items
         (batch_id, patient_id, appointment_id, medical_record_id, doctor_id,
          service_date, nomenclator_code, description, quantity,
          unit_amount, total_amount, affiliate_number, plan_code,
          diagnosis_code, authorization_code)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        batchId, dto.patientId, dto.appointmentId ?? null,
        dto.medicalRecordId ?? null, dto.doctorId,
        dto.serviceDate, dto.nomenclatorCode,
        item?.description ?? null, quantity,
        unitAmount, unitAmount * quantity,
        patient.insurance_number ?? null, patient.insurance_plan ?? null,
        dto.diagnosisCode ?? null, dto.authorizationCode ?? null,
      ],
    );

    if (!opts.skipAudit) {
      await this.auditItem(orgId, row.id);
      await this.recalcTotals(batchId);
    }

    return row;
  }

  // ═══════════════════════════════════════════════════════════
  // AUDITORÍA
  // ═══════════════════════════════════════════════════════════

  /**
   * Audita todo el lote antes de presentarlo.
   *
   * Esto es lo que le devuelve la plata al médico: cada línea que
   * sale con "blocked" es una que la obra social iba a rechazar y
   * que ahora se corrige antes de mandar.
   */
  async auditBatch(orgId: string, batchId: string) {
    const batch = await this.db.queryOne(
      `SELECT * FROM billing_batches WHERE id = $1 AND organization_id = $2`,
      [batchId, orgId],
    );
    if (!batch) throw new NotFoundException('Lote no encontrado');

    const items = await this.db.queryMany(
      `SELECT bi.*, p.date_of_birth, p.gender, p.insurance_number,
              p.first_name, p.last_name
       FROM billing_items bi
       JOIN patients p ON p.id = bi.patient_id
       WHERE bi.batch_id = $1
       ORDER BY bi.service_date`,
      [batchId],
    );

    let ok = 0, warning = 0, blocked = 0;
    const summary: Record<string, number> = {};

    for (const item of items) {
      const findings = await this.runChecks(batch, item, items);

      const status: AuditStatus = findings.some(f => f.status === 'blocked') ? 'blocked'
                                : findings.some(f => f.status === 'warning') ? 'warning'
                                : 'ok';

      for (const f of findings) {
        summary[f.note] = (summary[f.note] ?? 0) + 1;
      }

      if (status === 'ok') ok++;
      else if (status === 'warning') warning++;
      else blocked++;

      await this.db.query(
        `UPDATE billing_items SET audit_status = $1, audit_notes = $2 WHERE id = $3`,
        [status, findings.map(f => f.note), item.id],
      );
    }

    await this.db.query(
      `UPDATE billing_batches SET status = 'audited' WHERE id = $1 AND status = 'draft'`,
      [batchId],
    );

    return {
      total: items.length,
      ok, warning, blocked,
      canSubmit: blocked === 0,
      findings: Object.entries(summary)
        .map(([note, count]) => ({ note, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private async auditItem(orgId: string, itemId: string) {
    const item = await this.db.queryOne(
      `SELECT bi.*, p.date_of_birth, p.gender, p.insurance_number
       FROM billing_items bi
       JOIN patients p ON p.id = bi.patient_id
       WHERE bi.id = $1`,
      [itemId],
    );
    if (!item) return;

    const batch = await this.db.queryOne(
      `SELECT * FROM billing_batches WHERE id = $1`, [item.batch_id],
    );

    const siblings = await this.db.queryMany(
      `SELECT * FROM billing_items WHERE batch_id = $1`, [item.batch_id],
    );

    const findings = await this.runChecks(batch, item, siblings);
    const status: AuditStatus = findings.some(f => f.status === 'blocked') ? 'blocked'
                              : findings.some(f => f.status === 'warning') ? 'warning'
                              : 'ok';

    await this.db.query(
      `UPDATE billing_items SET audit_status = $1, audit_notes = $2 WHERE id = $3`,
      [status, findings.map(f => f.note), itemId],
    );
  }

  /**
   * Las reglas de auditoría.
   *
   * Salen de los motivos de rechazo más comunes en los instructivos
   * de facturación de los colegios médicos.
   */
  private async runChecks(batch: any, item: any, allItems: any[]): Promise<AuditFinding[]> {
    const out: AuditFinding[] = [];
    const serviceDate = item.service_date instanceof Date
      ? item.service_date.toISOString().slice(0, 10)
      : String(item.service_date).slice(0, 10);

    // El código tiene que existir en el nomenclador vigente a esa fecha
    const nomItem = await this.nomenclators.lookupCode(
      batch.insurer_id, item.nomenclator_code, serviceDate, batch.organization_id,
    );

    if (!nomItem) {
      out.push({
        status: 'blocked',
        note: `Código ${item.nomenclator_code} no existe en el nomenclador vigente al ${serviceDate}`,
      });
      return out; // Sin el item no se puede seguir chequeando
    }

    // Valorización
    if (!item.unit_amount || Number(item.unit_amount) <= 0) {
      out.push({ status: 'blocked', note: 'Prestación sin valor asignado' });
    }

    // Nro de afiliado
    if (!item.affiliate_number?.trim()) {
      out.push({ status: 'blocked', note: 'Falta el número de afiliado' });
    }

    // Diagnóstico
    if (nomItem.requires_diagnosis && !item.diagnosis_code?.trim()) {
      out.push({ status: 'blocked', note: 'Falta el diagnóstico (CIE-10)' });
    }

    // Autorización previa
    if (nomItem.requires_authorization && !item.authorization_code?.trim()) {
      out.push({
        status: 'blocked',
        note: `${item.nomenclator_code} requiere autorización previa y no la tiene`,
      });
    }

    // Restricción de edad
    if (item.date_of_birth && (nomItem.min_age != null || nomItem.max_age != null)) {
      const age = this.ageAt(item.date_of_birth, serviceDate);
      if (nomItem.min_age != null && age < nomItem.min_age) {
        out.push({ status: 'blocked', note: `Paciente menor a la edad mínima del código (${nomItem.min_age})` });
      }
      if (nomItem.max_age != null && age > nomItem.max_age) {
        out.push({ status: 'blocked', note: `Paciente mayor a la edad máxima del código (${nomItem.max_age})` });
      }
    }

    // Restricción por género
    if (nomItem.gender_restriction && item.gender && item.gender !== 'not_specified') {
      if (nomItem.gender_restriction !== item.gender) {
        out.push({ status: 'blocked', note: 'Práctica no corresponde al género del paciente' });
      }
    }

    // Tope de repeticiones por período
    if (nomItem.max_per_period && nomItem.period_days) {
      const repeats = allItems.filter(i =>
        i.patient_id === item.patient_id &&
        i.nomenclator_code === item.nomenclator_code &&
        this.daysBetween(i.service_date, item.service_date) <= nomItem.period_days,
      ).length;

      if (repeats > nomItem.max_per_period) {
        out.push({
          status: 'blocked',
          note: `${item.nomenclator_code} excede el tope de ${nomItem.max_per_period} cada ${nomItem.period_days} días`,
        });
      }
    }

    // Duplicado exacto — mismo paciente, mismo código, mismo día
    const sameDay = allItems.filter(i =>
      i.id !== item.id &&
      i.patient_id === item.patient_id &&
      i.nomenclator_code === item.nomenclator_code &&
      this.sameDate(i.service_date, item.service_date),
    );
    if (sameDay.length > 0) {
      out.push({ status: 'warning', note: 'Prestación repetida el mismo día para el mismo paciente' });
    }

    // Prestación fuera del período que se factura
    const [y, m] = [batch.period_year, batch.period_month];
    const d = new Date(serviceDate + 'T00:00:00');
    if (d.getFullYear() !== y || d.getMonth() + 1 !== m) {
      out.push({
        status: 'warning',
        note: `Prestación del ${serviceDate} en el lote de ${m}/${y}`,
      });
    }

    // Coseguro sin registrar
    if (nomItem.coinsurance && Number(nomItem.coinsurance) > 0) {
      out.push({
        status: 'warning',
        note: `Tiene coseguro de $${Number(nomItem.coinsurance).toLocaleString('es-AR')} a cobrar al paciente`,
      });
    }

    return out;
  }

  // ═══════════════════════════════════════════════════════════
  // EXPORTACIÓN
  // ═══════════════════════════════════════════════════════════

  /** CSV con el detalle del lote, listo para presentar o revisar */
  async exportCsv(orgId: string, batchId: string): Promise<string> {
    const batch = await this.db.queryOne(
      `SELECT bb.*, i.name AS insurer_name, o.name AS org_name, o.cuit AS org_cuit
       FROM billing_batches bb
       JOIN insurers i ON i.id = bb.insurer_id
       JOIN organizations o ON o.id = bb.organization_id
       WHERE bb.id = $1 AND bb.organization_id = $2`,
      [batchId, orgId],
    );
    if (!batch) throw new NotFoundException('Lote no encontrado');

    const items = await this.db.queryMany(
      `SELECT bi.*, p.first_name, p.last_name, p.dni,
              d.first_name AS doc_first, d.last_name AS doc_last, d.medical_license
       FROM billing_items bi
       JOIN patients p ON p.id = bi.patient_id
       LEFT JOIN doctors d ON d.id = bi.doctor_id
       WHERE bi.batch_id = $1
       ORDER BY bi.service_date, p.last_name`,
      [batchId],
    );

    const header = [
      'Fecha', 'Afiliado', 'Plan', 'Apellido y nombre', 'DNI',
      'Codigo', 'Descripcion', 'Cantidad', 'Valor unitario', 'Total',
      'Diagnostico', 'Autorizacion', 'Matricula', 'Profesional', 'Auditoria',
    ];

    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [header.join(';')];

    for (const it of items) {
      lines.push([
        this.fmtDate(it.service_date),
        it.affiliate_number ?? '',
        it.plan_code ?? '',
        `${it.last_name}, ${it.first_name}`,
        it.dni ?? '',
        it.nomenclator_code,
        it.description ?? '',
        it.quantity,
        this.fmtNum(it.unit_amount),
        this.fmtNum(it.total_amount),
        it.diagnosis_code ?? '',
        it.authorization_code ?? '',
        it.medical_license ?? '',
        it.doc_last ? `${it.doc_last}, ${it.doc_first}` : '',
        it.audit_status,
      ].map(esc).join(';'));
    }

    lines.push('');
    lines.push(`Total de prestaciones;${items.length}`);
    lines.push(`Importe total;${this.fmtNum(batch.total_amount)}`);
    lines.push(`Período;${String(batch.period_month).padStart(2,'0')}/${batch.period_year}`);
    lines.push(`Financiador;${esc(batch.insurer_name)}`);
    lines.push(`Prestador;${esc(batch.org_name)}`);
    if (batch.org_cuit) lines.push(`CUIT;${batch.org_cuit}`);

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  // CONSULTA Y ESTADO
  // ═══════════════════════════════════════════════════════════

  async listBatches(orgId: string, filters: { year?: number; status?: string } = {}) {
    let where = 'WHERE bb.organization_id = $1';
    const params: unknown[] = [orgId];
    let p = 2;

    if (filters.year) {
      where += ` AND bb.period_year = $${p}`;
      params.push(filters.year);
      p++;
    }
    if (filters.status) {
      where += ` AND bb.status = $${p}`;
      params.push(filters.status);
      p++;
    }

    return this.db.queryMany(
      `SELECT bb.*, i.name AS insurer_name, i.short_name AS insurer_short,
              COUNT(bi.id) AS item_count,
              COUNT(bi.id) FILTER (WHERE bi.audit_status = 'blocked') AS blocked_count,
              COUNT(bi.id) FILTER (WHERE bi.audit_status = 'warning') AS warning_count
       FROM billing_batches bb
       JOIN insurers i ON i.id = bb.insurer_id
       LEFT JOIN billing_items bi ON bi.batch_id = bb.id
       ${where}
       GROUP BY bb.id, i.name, i.short_name
       ORDER BY bb.period_year DESC, bb.period_month DESC`,
      params,
    );
  }

  async getBatch(orgId: string, batchId: string) {
    const batch = await this.db.queryOne(
      `SELECT bb.*, i.name AS insurer_name
       FROM billing_batches bb
       JOIN insurers i ON i.id = bb.insurer_id
       WHERE bb.id = $1 AND bb.organization_id = $2`,
      [batchId, orgId],
    );
    if (!batch) throw new NotFoundException('Lote no encontrado');

    const items = await this.db.queryMany(
      `SELECT bi.*, p.first_name, p.last_name, p.dni
       FROM billing_items bi
       JOIN patients p ON p.id = bi.patient_id
       WHERE bi.batch_id = $1
       ORDER BY bi.audit_status DESC, bi.service_date`,
      [batchId],
    );

    return { ...batch, items };
  }

  async removeItem(orgId: string, batchId: string, itemId: string) {
    const batch = await this.db.queryOne(
      `SELECT status FROM billing_batches WHERE id = $1 AND organization_id = $2`,
      [batchId, orgId],
    );
    if (!batch) throw new NotFoundException('Lote no encontrado');
    if (batch.status !== 'draft' && batch.status !== 'audited') {
      throw new BadRequestException('El lote ya fue presentado');
    }

    await this.db.query(`DELETE FROM billing_items WHERE id = $1 AND batch_id = $2`, [itemId, batchId]);
    await this.recalcTotals(batchId);
    return { message: 'Línea eliminada' };
  }

  async markSubmitted(orgId: string, batchId: string, batchNumber?: string) {
    const audit = await this.auditBatch(orgId, batchId);
    if (!audit.canSubmit) {
      throw new BadRequestException(
        `El lote tiene ${audit.blocked} líneas con errores que la obra social va a rechazar. Corregilas antes de presentar.`,
      );
    }

    return this.db.queryOne(
      `UPDATE billing_batches
       SET status = 'submitted', submitted_at = NOW(), batch_number = COALESCE($3, batch_number)
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [batchId, orgId, batchNumber ?? null],
    );
  }

  // ─── Internas ─────────────────────────────────────────────

  /** Valor de una prestación: monto directo, o unidades por el valor del galeno */
  private valorize(item: any): number {
    if (item.amount != null) return Number(item.amount);

    const unitValue = Number(item.nomenclator?.unit_value ?? 0);
    if (!unitValue) return 0;

    const prof = Number(item.professional_units ?? 0);
    const op = Number(item.operative_units ?? 0);
    return (prof + op) * unitValue;
  }

  private async defaultConsultationCode(orgId: string, insurerId: string): Promise<string | null> {
    const row = await this.db.queryOne(
      `SELECT ni.code
       FROM nomenclators n
       JOIN nomenclator_items ni ON ni.nomenclator_id = n.id
       WHERE n.insurer_id = $1
         AND (n.organization_id = $2 OR n.organization_id IS NULL)
         AND n.is_active
         AND (ni.description ILIKE '%consulta%' OR ni.specialty ILIKE '%consulta%')
       ORDER BY n.valid_from DESC, LENGTH(ni.code)
       LIMIT 1`,
      [insurerId, orgId],
    );
    return row?.code ?? null;
  }

  private async recalcTotals(batchId: string) {
    await this.db.query(
      `UPDATE billing_batches bb
       SET total_items = s.n, total_amount = COALESCE(s.total, 0)
       FROM (
         SELECT COUNT(*) AS n, SUM(total_amount) AS total
         FROM billing_items WHERE batch_id = $1
       ) s
       WHERE bb.id = $1`,
      [batchId],
    );
  }

  private ageAt(dob: Date | string, at: string): number {
    const birth = new Date(dob);
    const date = new Date(at + 'T00:00:00');
    let age = date.getFullYear() - birth.getFullYear();
    const m = date.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && date.getDate() < birth.getDate())) age--;
    return age;
  }

  private daysBetween(a: Date | string, b: Date | string): number {
    return Math.abs(
      (new Date(a).getTime() - new Date(b).getTime()) / 86400000,
    );
  }

  private sameDate(a: Date | string, b: Date | string): boolean {
    return this.fmtDate(a) === this.fmtDate(b);
  }

  private fmtDate(d: Date | string): string {
    const date = d instanceof Date ? d : new Date(d);
    return date.toISOString().slice(0, 10);
  }

  private fmtNum(n: unknown): string {
    return Number(n ?? 0).toFixed(2).replace('.', ',');
  }
}
