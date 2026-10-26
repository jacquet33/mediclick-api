import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

// ═══════════════════════════════════════════════════════════
// Historia Clínica — PDF completo de un paciente
// Ley 26.529: inalterabilidad, trazabilidad, confidencialidad
// ═══════════════════════════════════════════════════════════

// Brand palette
const TINTA = '#161925';
const LAVANDA = '#879DFF';
const CREMA = '#FFF7F3';
const ARENA = '#DCC7BB';
const TEXT_SOFT = '#5A5D6D';
const TEXT_MUTED = '#9A9DAD';

interface VitalSigns {
  bloodPressure?: string;
  heartRate?: number;
  temperature?: number;
  respiratoryRate?: number;
  spO2?: number;
  weight?: number;
  height?: number;
  waistCircumference?: number;
  shoulderWidth?: number;
}

@Injectable()
export class MedicalRecordPdfService {
  private readonly logger = new Logger(MedicalRecordPdfService.name);

  constructor(private db: DatabaseService) {}

  /**
   * Genera un PDF con la Historia Clínica completa del paciente:
   * datos demográficos, antecedentes, y todos los registros médicos.
   */
  async generatePatientHistoryPdf(
    orgId: string,
    doctorId: string,
    patientId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    // 1) Cargar datos del paciente
    const patient = await this.db.queryOne(
      `SELECT p.*, o.name AS org_name, o.address AS org_address,
              o.city AS org_city, o.province AS org_province,
              o.phone AS org_phone, o.cuit AS org_cuit
       FROM patients p
       JOIN organizations o ON o.id = p.organization_id
       WHERE p.id = $1 AND p.organization_id = $2`,
      [patientId, orgId],
    );
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    // 2) Cargar datos del médico (quien genera el PDF)
    const doctor = await this.db.queryOne(
      `SELECT first_name, last_name, medical_license, medical_license_province,
              specialty, signature_image, email
       FROM doctors WHERE id = $1`,
      [doctorId],
    );

    // 3) Cargar todos los registros médicos
    const records = await this.db.queryMany(
      `SELECT mr.*, d.first_name || ' ' || d.last_name AS doctor_name,
              d.medical_license AS doctor_license, d.specialty AS doctor_specialty
       FROM medical_records mr
       JOIN doctors d ON d.id = mr.doctor_id
       WHERE mr.patient_id = $1 AND mr.organization_id = $2 AND mr.deleted_at IS NULL
       ORDER BY mr.date DESC`,
      [patientId, orgId],
    );

    // 4) Cargar recetas
    const prescriptions = await this.db.queryMany(
      `SELECT rx.*, d.first_name || ' ' || d.last_name AS doctor_name
       FROM prescriptions rx
       JOIN doctors d ON d.id = rx.doctor_id
       WHERE rx.patient_id = $1 AND rx.organization_id = $2
       ORDER BY rx.issued_at DESC`,
      [patientId, orgId],
    );

    // 5) Cargar turnos
    const appointments = await this.db.queryMany(
      `SELECT a.*, d.first_name || ' ' || d.last_name AS doctor_name
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       WHERE a.patient_id = $1 AND a.organization_id = $2
       ORDER BY a.date DESC, a.start_time DESC
       LIMIT 50`,
      [patientId, orgId],
    );

    const patientName = `${patient.first_name} ${patient.last_name}`;
    const filename = `HC_${patientName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;

    const buffer = await this.buildPdf(patient, doctor, records, prescriptions, appointments);

    return { buffer, filename };
  }

  // ─── PDF Builder ─────────────────────────────────────────

  private buildPdf(
    patient: any,
    doctor: any,
    records: any[],
    prescriptions: any[],
    appointments: any[],
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 60, left: 50, right: 50 },
        bufferPages: true,
        info: {
          Title: `Historia Clínica - ${patient.first_name} ${patient.last_name}`,
          Author: doctor ? `Dr. ${doctor.first_name} ${doctor.last_name}` : 'MediClick',
          Subject: 'Historia Clínica Digital',
          Creator: 'MediClick',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const LEFT = doc.page.margins.left;

      const patientName = `${patient.first_name} ${patient.last_name}`;
      const doctorName = doctor ? `${doctor.first_name} ${doctor.last_name}` : '';

      // ═══ PAGE 1: Cover + Patient Data ═══════════════════════

      this.renderHeader(doc, LEFT, W, patient);
      this.renderPatientData(doc, LEFT, W, patient);
      this.renderPatientBackground(doc, LEFT, W, records);

      // ═══ REGISTROS MÉDICOS ══════════════════════════════════

      if (records.length > 0) {
        this.checkPage(doc, 100);
        this.sectionTitle(doc, LEFT, W, 'REGISTROS MÉDICOS', `${records.length} registro(s)`);

        for (const record of records) {
          this.checkPage(doc, 120);
          this.renderRecord(doc, LEFT, W, record);
        }
      }

      // ═══ RECETAS ════════════════════════════════════════════

      if (prescriptions.length > 0) {
        this.checkPage(doc, 80);
        this.sectionTitle(doc, LEFT, W, 'RECETAS', `${prescriptions.length} receta(s)`);

        for (const rx of prescriptions) {
          this.checkPage(doc, 60);
          this.renderPrescription(doc, LEFT, W, rx);
        }
      }

      // ═══ TURNOS ═════════════════════════════════════════════

      if (appointments.length > 0) {
        this.checkPage(doc, 80);
        this.sectionTitle(doc, LEFT, W, 'HISTORIAL DE TURNOS', `Últimos ${appointments.length}`);

        this.renderAppointmentsTable(doc, LEFT, W, appointments);
      }

      // ═══ FIRMA Y CIERRE ════════════════════════════════════

      this.checkPage(doc, 150);
      this.renderSignature(doc, LEFT, W, doctor);

      // ═══ FOOTER en todas las páginas ═══════════════════════

      const totalPages = doc.bufferedPageRange().count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        this.renderFooter(doc, LEFT, W, patientName, i + 1, totalPages);
      }

      doc.end();
    });
  }

  // ─── Header ──────────────────────────────────────────────

  private renderHeader(doc: any, LEFT: number, W: number, patient: any) {
    let y = doc.page.margins.top;

    // Top accent bar
    doc.rect(LEFT, y, W, 5).fill(TINTA);
    y += 5;
    doc.rect(LEFT, y, W * 0.4, 2).fill(LAVANDA);
    y += 14;

    // MEDICLICK branding
    doc.fontSize(22).font('Helvetica-Bold').fillColor(TINTA)
      .text('MediClick', LEFT, y);
    doc.fontSize(9).font('Helvetica').fillColor(LAVANDA)
      .text('HISTORIA CLÍNICA DIGITAL', LEFT + 115, y + 8);

    // Organization info (right)
    if (patient.org_name) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(TINTA)
        .text(patient.org_name, LEFT + W / 2, y, { width: W / 2, align: 'right' });
      const addr = [patient.org_address, patient.org_city, patient.org_province].filter(Boolean).join(', ');
      if (addr) {
        doc.fontSize(7.5).font('Helvetica').fillColor(TEXT_SOFT)
          .text(addr, LEFT + W / 2, y + 14, { width: W / 2, align: 'right' });
      }
      if (patient.org_phone) {
        doc.fontSize(7.5).text(`Tel: ${patient.org_phone}`, LEFT + W / 2, y + 24, { width: W / 2, align: 'right' });
      }
      if (patient.org_cuit) {
        doc.fontSize(7.5).text(`CUIT: ${patient.org_cuit}`, LEFT + W / 2, y + 34, { width: W / 2, align: 'right' });
      }
    }

    y += 50;

    // Separator
    doc.moveTo(LEFT, y).lineTo(LEFT + W, y).lineWidth(1).strokeColor(ARENA).stroke();
    y += 8;

    // Date
    doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
      .text(`Generada el ${this.fmtDateTime(new Date())}`, LEFT, y, { width: W, align: 'right' });
    y += 18;

    doc.y = y;
  }

  // ─── Patient Data ────────────────────────────────────────

  private renderPatientData(doc: any, LEFT: number, W: number, patient: any) {
    let y = doc.y;

    // Title
    doc.fontSize(13).font('Helvetica-Bold').fillColor(TINTA)
      .text('DATOS DEL PACIENTE', LEFT, y);
    y += 20;

    // Card background
    const cardH = 95;
    doc.roundedRect(LEFT, y, W, cardH, 6).fill(CREMA);
    y += 10;

    const col1 = LEFT + 12;
    const col2 = LEFT + W / 2 + 10;
    const colW = W / 2 - 22;

    // Row 1
    this.labelValue(doc, col1, y, colW, 'Nombre completo', `${patient.first_name} ${patient.last_name}`);
    this.labelValue(doc, col2, y, colW, 'DNI', patient.dni || '—');
    y += 20;

    // Row 2
    const gender = patient.gender === 'female' ? 'Femenino' : patient.gender === 'male' ? 'Masculino' : patient.gender || '—';
    this.labelValue(doc, col1, y, colW, 'Sexo', gender);
    this.labelValue(doc, col2, y, colW, 'Fecha de nacimiento', patient.date_of_birth ? this.fmtDate(patient.date_of_birth) : '—');
    y += 20;

    // Row 3
    this.labelValue(doc, col1, y, colW, 'Teléfono', patient.phone || '—');
    this.labelValue(doc, col2, y, colW, 'Email', patient.email || '—');
    y += 20;

    // Row 4 — Insurance
    y += 10;
    if (patient.insurance_provider) {
      doc.roundedRect(LEFT, y, W, 30, 6).fill('#EEF0FF');
      y += 8;
      this.labelValue(doc, col1, y, colW * 0.6, 'Obra Social', patient.insurance_provider);
      this.labelValue(doc, col1 + colW * 0.6 + 10, y, colW * 0.4, 'Plan', patient.insurance_plan || '—');
      this.labelValue(doc, col2, y, colW, 'N° Afiliado', patient.insurance_number || '—');
      y += 30;
    } else {
      y += 5;
    }

    doc.y = y + 10;
  }

  // ─── Patient Background (antecedentes) ───────────────────

  private renderPatientBackground(doc: any, LEFT: number, W: number, records: any[]) {
    // Extract latest background data from most recent record
    const latest = records.find((r) => r.personal_history || r.family_history || r.allergies || r.habits);
    if (!latest) return;

    this.checkPage(doc, 100);
    let y = doc.y;

    doc.fontSize(13).font('Helvetica-Bold').fillColor(TINTA)
      .text('ANTECEDENTES', LEFT, y);
    y += 20;

    const sections = [
      { label: 'Antecedentes personales', value: latest.personal_history },
      { label: 'Antecedentes familiares', value: latest.family_history },
      { label: 'Alergias', value: latest.allergies },
      { label: 'Hábitos', value: latest.habits },
      { label: 'Medicación habitual', value: latest.current_medications },
      { label: 'Ocupación', value: latest.occupation },
    ];

    for (const sec of sections) {
      if (!sec.value) continue;
      this.checkPage(doc, 30);
      y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_SOFT)
        .text(sec.label + ':', LEFT + 5, y);
      y += 13;
      doc.fontSize(9).font('Helvetica').fillColor(TINTA)
        .text(sec.value, LEFT + 15, y, { width: W - 30 });
      y = doc.y + 8;
      doc.y = y;
    }

    doc.y += 5;
  }

  // ─── Section Title ───────────────────────────────────────

  private sectionTitle(doc: any, LEFT: number, W: number, title: string, subtitle?: string) {
    let y = doc.y;
    doc.moveTo(LEFT, y).lineTo(LEFT + W, y).lineWidth(0.5).strokeColor(ARENA).stroke();
    y += 12;

    doc.fontSize(13).font('Helvetica-Bold').fillColor(TINTA)
      .text(title, LEFT, y);

    if (subtitle) {
      doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
        .text(subtitle, LEFT + W - 100, y + 3, { width: 100, align: 'right' });
    }

    y += 22;
    doc.y = y;
  }

  // ─── Individual Record ───────────────────────────────────

  private renderRecord(doc: any, LEFT: number, W: number, record: any) {
    let y = doc.y;

    // Card border
    doc.roundedRect(LEFT, y, W, 2, 1).fill(LAVANDA);
    y += 4;

    // Date + doctor
    doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
      .text(this.fmtDate(record.date), LEFT + 5, y);
    doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
      .text(`Dr/a. ${record.doctor_name} — MP ${record.doctor_license || 'S/N'}`,
        LEFT + W / 3, y, { width: W * 2 / 3 - 5, align: 'right' });
    y += 14;

    // Record type badge
    const typeLabel = this.recordTypeLabel(record.record_type);
    doc.roundedRect(LEFT + 5, y, 75, 15, 3).fill('#EEF0FF');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(LAVANDA)
      .text(typeLabel, LEFT + 8, y + 3, { width: 70, align: 'center' });
    y += 20;

    // Chief complaint
    if (record.chief_complaint) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TINTA)
        .text('Motivo de consulta:', LEFT + 5, y);
      y += 13;
      doc.fontSize(9).font('Helvetica').fillColor(TINTA)
        .text(record.chief_complaint, LEFT + 15, y, { width: W - 30 });
      y = doc.y + 6;
    }

    // Present illness
    if (record.present_illness) {
      this.checkPage(doc, 30);
      y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_SOFT)
        .text('Enfermedad actual:', LEFT + 5, y);
      y += 13;
      doc.fontSize(9).font('Helvetica').fillColor(TINTA)
        .text(record.present_illness, LEFT + 15, y, { width: W - 30 });
      y = doc.y + 6;
    }

    // Vital signs
    if (record.vital_signs) {
      const vs: VitalSigns = typeof record.vital_signs === 'string'
        ? JSON.parse(record.vital_signs)
        : record.vital_signs;

      if (Object.values(vs).some(Boolean)) {
        this.checkPage(doc, 30);
        y = doc.y;
        doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_SOFT)
          .text('Signos vitales:', LEFT + 5, y);
        y += 13;

        const vitals: string[] = [];
        if (vs.bloodPressure) vitals.push(`TA: ${vs.bloodPressure} mmHg`);
        if (vs.heartRate) vitals.push(`FC: ${vs.heartRate} lpm`);
        if (vs.temperature) vitals.push(`T°: ${vs.temperature}°C`);
        if (vs.respiratoryRate) vitals.push(`FR: ${vs.respiratoryRate} rpm`);
        if (vs.spO2) vitals.push(`SpO2: ${vs.spO2}%`);
        if (vs.weight) vitals.push(`Peso: ${vs.weight} kg`);
        if (vs.height) vitals.push(`Talla: ${vs.height} cm`);

        doc.fontSize(8.5).font('Helvetica').fillColor(TINTA)
          .text(vitals.join('   |   '), LEFT + 15, y, { width: W - 30 });
        y = doc.y + 6;
      }
    }

    // Physical exam
    if (record.physical_exam) {
      this.checkPage(doc, 30);
      y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_SOFT)
        .text('Examen físico:', LEFT + 5, y);
      y += 13;
      doc.fontSize(9).font('Helvetica').fillColor(TINTA)
        .text(record.physical_exam, LEFT + 15, y, { width: W - 30 });
      y = doc.y + 6;
    }

    // Findings
    if (record.findings) {
      this.checkPage(doc, 30);
      y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_SOFT)
        .text('Hallazgos:', LEFT + 5, y);
      y += 13;
      doc.fontSize(9).font('Helvetica').fillColor(TINTA)
        .text(record.findings, LEFT + 15, y, { width: W - 30 });
      y = doc.y + 6;
    }

    // Diagnosis
    if (record.diagnosis) {
      this.checkPage(doc, 30);
      y = doc.y;
      doc.roundedRect(LEFT + 5, y, W - 10, 2, 1).fill(ARENA);
      y += 6;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TINTA)
        .text('Diagnóstico:', LEFT + 5, y, { continued: true })
        .font('Helvetica')
        .text(` ${record.diagnosis_code ? `${record.diagnosis_code} — ` : ''}${record.diagnosis}`);
      y = doc.y + 6;
    }

    // Secondary diagnoses
    if (record.secondary_diagnoses) {
      const secondary = typeof record.secondary_diagnoses === 'string'
        ? JSON.parse(record.secondary_diagnoses)
        : record.secondary_diagnoses;

      if (Array.isArray(secondary) && secondary.length > 0) {
        y = doc.y;
        doc.fontSize(8).font('Helvetica').fillColor(TEXT_SOFT)
          .text('Diagnósticos secundarios: ' + secondary.map((d: any) =>
            d.code ? `${d.code} — ${d.diagnosis}` : d.diagnosis).join('; '),
            LEFT + 15, y, { width: W - 30 });
        y = doc.y + 6;
      }
    }

    // Treatment plan
    if (record.treatment_plan) {
      this.checkPage(doc, 30);
      y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_SOFT)
        .text('Plan de tratamiento:', LEFT + 5, y);
      y += 13;
      doc.fontSize(9).font('Helvetica').fillColor(TINTA)
        .text(record.treatment_plan, LEFT + 15, y, { width: W - 30 });
      y = doc.y + 6;
    }

    // Instructions
    if (record.instructions) {
      this.checkPage(doc, 20);
      y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_SOFT)
        .text('Indicaciones:', LEFT + 5, y);
      y += 13;
      doc.fontSize(9).font('Helvetica').fillColor(TINTA)
        .text(record.instructions, LEFT + 15, y, { width: W - 30 });
      y = doc.y + 6;
    }

    // Lab / imaging / referrals
    const orders = [
      { label: 'Laboratorio', value: record.lab_orders },
      { label: 'Imágenes', value: record.imaging_orders },
      { label: 'Derivaciones', value: record.referrals },
    ];
    for (const order of orders) {
      const items = Array.isArray(order.value) ? order.value : [];
      if (items.length > 0) {
        this.checkPage(doc, 20);
        y = doc.y;
        doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT_SOFT)
          .text(`${order.label}: `, LEFT + 5, y, { continued: true })
          .font('Helvetica').fillColor(TINTA)
          .text(items.join(', '));
        y = doc.y + 4;
      }
    }

    // Follow up
    if (record.follow_up) {
      y = doc.y;
      doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
        .text(`Seguimiento: ${record.follow_up}`, LEFT + 5, y);
    }

    doc.y = doc.y + 18;
  }

  // ─── Prescription Summary ───────────────────────────────

  private renderPrescription(doc: any, LEFT: number, W: number, rx: any) {
    let y = doc.y;

    // Date + status
    const statusLabel = rx.status === 'active' ? 'Vigente' : rx.status === 'cancelled' ? 'Cancelada' : rx.status === 'expired' ? 'Vencida' : rx.status;
    doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
      .text(`${this.fmtDate(rx.issued_at)} — Dr/a. ${rx.doctor_name}`, LEFT + 5, y);

    doc.fontSize(8).font('Helvetica-Bold')
      .fillColor(rx.status === 'active' ? '#10B981' : TEXT_MUTED)
      .text(statusLabel, LEFT + W - 80, y, { width: 75, align: 'right' });
    y += 14;

    // Diagnosis
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TINTA)
      .text(`Dx: ${rx.diagnosis || '—'}`, LEFT + 5, y, { width: W - 10 });
    y = doc.y + 4;

    // Notes
    if (rx.notes) {
      doc.fontSize(8).font('Helvetica').fillColor(TEXT_SOFT)
        .text(rx.notes, LEFT + 15, y, { width: W - 30 });
      y = doc.y + 4;
    }

    // Separator
    doc.moveTo(LEFT + 10, y + 4).lineTo(LEFT + W - 10, y + 4).lineWidth(0.3).strokeColor(ARENA).stroke();
    doc.y = y + 12;
  }

  // ─── Appointments Table ─────────────────────────────────

  private renderAppointmentsTable(doc: any, LEFT: number, W: number, appointments: any[]) {
    let y = doc.y;

    // Table header
    doc.roundedRect(LEFT, y, W, 16, 3).fill(TINTA);
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text('Fecha', LEFT + 8, y + 4, { width: 80 })
      .text('Hora', LEFT + 88, y + 4, { width: 50 })
      .text('Doctor/a', LEFT + 138, y + 4, { width: 150 })
      .text('Motivo', LEFT + 288, y + 4, { width: 120 })
      .text('Estado', LEFT + W - 70, y + 4, { width: 65, align: 'right' });
    y += 20;

    for (const apt of appointments) {
      this.checkPage(doc, 16);
      y = doc.y;

      const bg = appointments.indexOf(apt) % 2 === 0 ? CREMA : '#FFFFFF';
      doc.rect(LEFT, y, W, 15).fill(bg);

      const statusLbl = apt.status === 'completed' ? 'Atendido' :
        apt.status === 'cancelled' ? 'Cancelado' :
        apt.status === 'no_show' ? 'Ausente' :
        apt.status === 'confirmed' ? 'Confirmado' : apt.status;

      doc.fontSize(7.5).font('Helvetica').fillColor(TINTA)
        .text(this.fmtDate(apt.date), LEFT + 8, y + 4, { width: 80 })
        .text(apt.start_time ? String(apt.start_time).slice(0, 5) : '—', LEFT + 88, y + 4, { width: 50 })
        .text(apt.doctor_name || '—', LEFT + 138, y + 4, { width: 150 })
        .text(apt.reason || '—', LEFT + 288, y + 4, { width: 120 });

      doc.fontSize(7).font('Helvetica-Bold')
        .fillColor(apt.status === 'completed' ? '#10B981' : apt.status === 'cancelled' ? '#EF4444' : TEXT_MUTED)
        .text(statusLbl, LEFT + W - 70, y + 4, { width: 65, align: 'right' });

      doc.y = y + 16;
    }

    doc.y += 10;
  }

  // ─── Signature Block ────────────────────────────────────

  private renderSignature(doc: any, LEFT: number, W: number, doctor: any) {
    let y = doc.y + 30;

    doc.moveTo(LEFT, y).lineTo(LEFT + W, y).lineWidth(0.5).strokeColor(ARENA).stroke();
    y += 15;

    doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
      .text('CONSTANCIA DE GENERACIÓN', LEFT, y, { width: W, align: 'center' });
    y += 16;

    // Signature image
    const sigCenterX = LEFT + W / 2;
    if (doctor?.signature_image) {
      try {
        const match = doctor.signature_image.match(/^data:image\/\w+;base64,(.+)$/);
        if (match) {
          const imgBuffer = Buffer.from(match[1], 'base64');
          doc.image(imgBuffer, sigCenterX - 80, y, { width: 160, height: 70, fit: [160, 70], align: 'center', valign: 'bottom' });
          y += 72;
        }
      } catch (err) {
        this.logger.warn(`Could not render signature: ${err.message}`);
      }
    }

    // Dotted line
    for (let sx = sigCenterX - 90; sx < sigCenterX + 90; sx += 5) {
      doc.moveTo(sx, y).lineTo(sx + 2, y).lineWidth(0.8).strokeColor(TEXT_MUTED).stroke();
    }
    y += 6;

    if (doctor) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(TINTA)
        .text(`Dr/a. ${doctor.first_name} ${doctor.last_name}`, LEFT, y, { width: W, align: 'center' });
      y += 14;
      doc.fontSize(9).font('Helvetica').fillColor(TEXT_SOFT)
        .text(doctor.specialty || 'Médico/a', LEFT, y, { width: W, align: 'center' });
      y += 13;
      doc.fontSize(9)
        .text(`MP ${doctor.medical_license_province || ''} ${doctor.medical_license || 'S/N'}`, LEFT, y, { width: W, align: 'center' });
      y += 16;
      doc.fontSize(7.5).font('Helvetica').fillColor(TEXT_MUTED)
        .text('FIRMA Y SELLO', LEFT, y, { width: W, align: 'center' });
    }

    y += 20;

    // Legal notice
    doc.fontSize(7).font('Helvetica-Oblique').fillColor(TEXT_MUTED)
      .text(
        'Historia Clínica generada digitalmente por MediClick. ' +
        'Conforme Ley 26.529 de Derechos del Paciente en su Relación con los Profesionales e Instituciones de la Salud. ' +
        'Ley 25.326 de Protección de los Datos Personales.',
        LEFT, y, { width: W, align: 'center' },
      );

    doc.y = y + 20;
  }

  // ─── Footer (all pages) ─────────────────────────────────

  private renderFooter(doc: any, LEFT: number, W: number, patientName: string, page: number, total: number) {
    const footerY = doc.page.height - 45;

    doc.rect(LEFT, footerY, W, 0.5).fill(ARENA);

    doc.fontSize(7).font('Helvetica').fillColor(TEXT_MUTED)
      .text(`HC — ${patientName}`, LEFT, footerY + 6)
      .text(`Página ${page} de ${total}`, LEFT + W - 80, footerY + 6, { width: 80, align: 'right' });

    doc.fontSize(6).fillColor(TEXT_MUTED)
      .text('MediClick · Documento confidencial', LEFT, footerY + 18, { width: W, align: 'center' });
  }

  // ─── Helpers ─────────────────────────────────────────────

  private labelValue(doc: any, x: number, y: number, w: number, label: string, value: string) {
    doc.fontSize(7.5).font('Helvetica').fillColor(TEXT_MUTED)
      .text(label, x, y, { width: w });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TINTA)
      .text(value || '—', x, y + 10, { width: w });
  }

  private checkPage(doc: any, needed: number) {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  }

  private fmtDate(d: Date | string): string {
    const dt = new Date(d);
    return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  private fmtDateTime(d: Date): string {
    return d.toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  private recordTypeLabel(type: string): string {
    switch (type) {
      case 'consulta': return 'CONSULTA';
      case 'control': return 'CONTROL';
      case 'urgencia': return 'URGENCIA';
      case 'interconsulta': return 'INTERCONSULTA';
      case 'cirugía': return 'CIRUGÍA';
      default: return (type || 'CONSULTA').toUpperCase();
    }
  }
}
