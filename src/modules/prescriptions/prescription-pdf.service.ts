import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

interface PrescriptionData {
  // Receta
  id: string;
  diagnosis: string;
  diagnosis_code: string;
  issued_at: Date;
  expires_at: Date;
  verification_code: string;
  status: string;
  notes: string;
  // Doctor
  doctor_first_name: string;
  doctor_last_name: string;
  doctor_email: string;
  doctor_phone: string;
  doctor_medical_license: string;
  doctor_specialty: string;
  // Paciente
  patient_first_name: string;
  patient_last_name: string;
  patient_dni: string;
  patient_date_of_birth: Date;
  patient_gender: string;
  patient_blood_type: string;
  patient_insurance_provider: string;
  patient_insurance_plan: string;
  patient_insurance_number: string;
  // Organización
  org_name: string;
  org_type: string;
  org_phone: string;
  org_address: string;
  org_city: string;
  org_province: string;
  org_cuit: string;
  // Items
  items: Array<{
    medication_name: string;
    dosage: string;
    frequency: string;
    duration: string;
    quantity: number;
    instructions: string;
  }>;
}

@Injectable()
export class PrescriptionPdfService {
  private readonly logger = new Logger(PrescriptionPdfService.name);

  constructor(private db: DatabaseService) {}

  async generatePdf(orgId: string, prescriptionId: string): Promise<Buffer> {
    // 1) Cargar datos completos (sin filtrar por org, el ID es único)
    const rx = await this.db.queryOne(
      `SELECT 
        rx.*,
        d.first_name AS doctor_first_name, d.last_name AS doctor_last_name,
        d.email AS doctor_email, d.phone AS doctor_phone,
        d.medical_license AS doctor_medical_license, d.specialty AS doctor_specialty,
        p.first_name AS patient_first_name, p.last_name AS patient_last_name,
        p.dni AS patient_dni, p.date_of_birth AS patient_date_of_birth,
        p.gender AS patient_gender, p.blood_type AS patient_blood_type,
        p.insurance_provider AS patient_insurance_provider,
        p.insurance_plan AS patient_insurance_plan,
        p.insurance_number AS patient_insurance_number,
        o.name AS org_name, o.type AS org_type, o.phone AS org_phone,
        o.address AS org_address, o.city AS org_city, o.province AS org_province,
        o.cuit AS org_cuit
       FROM prescriptions rx
       JOIN doctors d ON d.id = rx.doctor_id
       JOIN patients p ON p.id = rx.patient_id
       JOIN organizations o ON o.id = rx.organization_id
       WHERE rx.id = $1::uuid`,
      [prescriptionId.toLowerCase()],
    );

    if (!rx) throw new NotFoundException('Receta no encontrada');

    const items = await this.db.queryMany(
      `SELECT * FROM prescription_items WHERE prescription_id = $1 ORDER BY sort_order`,
      [prescriptionId],
    );

    rx.items = items;

    // 2) Generar PDF
    return this.buildPdf(rx as PrescriptionData);
  }

  private buildPdf(rx: PrescriptionData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 50, right: 50 },
        info: {
          Title: `Receta - ${rx.patient_first_name} ${rx.patient_last_name}`,
          Author: `Dr. ${rx.doctor_first_name} ${rx.doctor_last_name}`,
          Subject: 'Receta Médica Digital',
          Creator: 'MediClick',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const LEFT = doc.page.margins.left;
      const RIGHT = LEFT + W;

      const fmtDate = (d: Date | string) => {
        const dt = new Date(d);
        return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      };

      const doctorName = `${rx.doctor_first_name} ${rx.doctor_last_name}`;
      const patientName = `${rx.patient_first_name} ${rx.patient_last_name}`.toUpperCase();
      const gender = rx.patient_gender === 'female' ? 'Femenino' : rx.patient_gender === 'male' ? 'Masculino' : 'Otro';

      let y = doc.page.margins.top;

      // ═══════════════════════════════════════════════════════
      // ENCABEZADO: Logo / Nombre consultorio
      // ═══════════════════════════════════════════════════════

      // Línea superior decorativa
      doc.rect(LEFT, y, W, 4).fill('#0097A7');
      y += 12;

      // MEDICLICK branding
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#0097A7')
        .text('MEDICLICK', LEFT, y, { width: W / 2 });

      doc.fontSize(8).font('Helvetica').fillColor('#666666')
        .text('RECETARIO DIGITAL', LEFT, y + 20, { width: W / 2 });

      // Organización (derecha)
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333')
        .text(rx.org_name || '', LEFT + W / 2, y, { width: W / 2, align: 'right' });

      const orgAddr = [rx.org_address, rx.org_city, rx.org_province].filter(Boolean).join(', ');
      if (orgAddr) {
        doc.fontSize(8).font('Helvetica').fillColor('#666666')
          .text(orgAddr, LEFT + W / 2, y + 15, { width: W / 2, align: 'right' });
      }
      if (rx.org_phone) {
        doc.fontSize(8).text(`Tel: ${rx.org_phone}`, LEFT + W / 2, y + 25, { width: W / 2, align: 'right' });
      }
      if (rx.org_cuit) {
        doc.fontSize(8).text(`CUIT: ${rx.org_cuit}`, LEFT + W / 2, y + 35, { width: W / 2, align: 'right' });
      }

      y += 50;

      // Datos del médico
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333')
        .text(`Dr/a. ${doctorName}`, LEFT, y, { width: W, align: 'center' });
      y += 15;

      doc.fontSize(9).font('Helvetica').fillColor('#555555')
        .text(`${rx.doctor_specialty || 'MÉDICO'}  |  Matrícula Prov.: ${rx.doctor_medical_license || 'S/N'}`, LEFT, y, { width: W, align: 'center' });
      y += 18;

      // Fechas
      const dateBlock = `Creada: ${fmtDate(rx.issued_at)}     Válida hasta: ${fmtDate(rx.expires_at)}`;
      doc.fontSize(8).font('Helvetica').fillColor('#666666')
        .text(dateBlock, LEFT, y, { width: W, align: 'center' });
      y += 18;

      // Línea separadora
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(1.5).strokeColor('#0097A7').stroke();
      y += 10;

      // ═══════════════════════════════════════════════════════
      // DATOS DEL PACIENTE
      // ═══════════════════════════════════════════════════════

      // Fondo celeste claro
      doc.rect(LEFT, y, W, 52).fill('#E0F7FA');
      y += 8;

      // Nombre
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
        .text(`Paciente: ${patientName}`, LEFT + 10, y, { width: W / 2 - 10, continued: false });

      doc.fontSize(9).font('Helvetica').fillColor('#555555')
        .text(`Sexo: ${gender}`, LEFT + W / 2, y, { width: W / 2 - 10, align: 'right' });
      y += 15;

      // DNI
      const dniLine = `DNI: ${rx.patient_dni || 'S/N'}`;
      doc.fontSize(9).font('Helvetica').fillColor('#444444')
        .text(dniLine, LEFT + 10, y, { width: W / 2 - 10 });

      if (rx.patient_date_of_birth) {
        doc.text(`F. Nacimiento: ${fmtDate(rx.patient_date_of_birth)}`, LEFT + W / 2, y, { width: W / 2 - 10, align: 'right' });
      }
      y += 14;

      // Obra social
      if (rx.patient_insurance_provider) {
        const insurance = [
          rx.patient_insurance_provider,
          rx.patient_insurance_plan ? `PLAN: ${rx.patient_insurance_plan}` : null,
          rx.patient_insurance_number ? `N° Credencial: ${rx.patient_insurance_number}` : null,
        ].filter(Boolean).join(' | ');

        doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444')
          .text(insurance, LEFT + 10, y, { width: W - 20 });
      }
      y += 20;

      // Línea separadora
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor('#CCCCCC').stroke();
      y += 15;

      // ═══════════════════════════════════════════════════════
      // CUERPO DE LA RECETA - Rp./
      // ═══════════════════════════════════════════════════════

      doc.fontSize(14).font('Helvetica-Bold').fillColor('#0097A7')
        .text('Rp./', LEFT, y);
      y += 22;

      // Medicamentos
      for (const item of rx.items) {
        // Bullet
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
          .text('•', LEFT + 5, y, { continued: true })
          .text(` ${item.medication_name}`, { continued: false });
        y += 14;

        // Detalles
        const details: string[] = [];
        if (item.dosage) details.push(item.dosage);
        if (item.frequency) details.push(item.frequency);
        if (item.duration) details.push(item.duration);
        if (item.quantity) details.push(`Cantidad: ${item.quantity}`);

        if (details.length > 0) {
          doc.fontSize(9).font('Helvetica').fillColor('#555555')
            .text(`  ${details.join(' — ')}`, LEFT + 15, y, { width: W - 30 });
          y += 13;
        }

        if (item.instructions) {
          doc.fontSize(8).font('Helvetica-Oblique').fillColor('#777777')
            .text(`  ${item.instructions}`, LEFT + 15, y, { width: W - 30 });
          y += 13;
        }

        y += 5;
      }

      y += 8;

      // Diagnóstico
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
        .text('Diagnóstico: ', LEFT, y, { continued: true })
        .font('Helvetica').text(
          rx.diagnosis_code
            ? `${rx.diagnosis_code} - ${rx.diagnosis}`
            : rx.diagnosis,
        );
      y += 20;

      // Notas
      if (rx.notes) {
        doc.fontSize(8).font('Helvetica-Oblique').fillColor('#777777')
          .text(`Observaciones: ${rx.notes}`, LEFT, y, { width: W });
        y += 16;
      }

      // ═══════════════════════════════════════════════════════
      // FIRMA Y SELLO
      // ═══════════════════════════════════════════════════════

      // Empujar firma hacia abajo (mínimo a 2/3 de la página)
      const signatureY = Math.max(y + 60, doc.page.height - 250);

      // Línea punteada de firma
      const sigCenterX = LEFT + W / 2;
      const sigLineW = 180;
      for (let sx = sigCenterX - sigLineW / 2; sx < sigCenterX + sigLineW / 2; sx += 5) {
        doc.moveTo(sx, signatureY).lineTo(sx + 2, signatureY).lineWidth(0.8).strokeColor('#999999').stroke();
      }

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
        .text(`Dr/a. ${doctorName}`, LEFT, signatureY + 6, { width: W, align: 'center' });

      doc.fontSize(9).font('Helvetica').fillColor('#555555')
        .text(rx.doctor_specialty || 'Médico', LEFT, signatureY + 20, { width: W, align: 'center' });

      doc.fontSize(9)
        .text(`MP. ${rx.doctor_medical_license || 'S/N'}`, LEFT, signatureY + 33, { width: W, align: 'center' });

      doc.fontSize(8).font('Helvetica-Bold').fillColor('#666666')
        .text('FIRMA Y SELLO', LEFT, signatureY + 50, { width: W, align: 'center' });

      // ═══════════════════════════════════════════════════════
      // PIE DE PÁGINA
      // ═══════════════════════════════════════════════════════

      const footerY = doc.page.height - 90;

      // Línea decorativa
      doc.rect(LEFT, footerY, W, 1).fill('#0097A7');

      // Info de firma digital
      doc.fontSize(7).font('Helvetica-Oblique').fillColor('#888888')
        .text(
          'Este documento ha sido generado digitalmente por MediClick.',
          LEFT, footerY + 8, { width: W * 0.55 },
        );

      doc.fontSize(7).text(fmtDate(rx.issued_at), LEFT, footerY + 20);

      // Bloque derecho: datos del médico + verificación
      const rightColX = LEFT + W * 0.55;

      doc.fontSize(8).font('Helvetica-Bold').fillColor('#555555')
        .text(rx.doctor_specialty?.toUpperCase() || 'MÉDICO', rightColX, footerY + 8, { width: W * 0.45, align: 'center' });

      doc.fontSize(8).font('Helvetica').fillColor('#555555')
        .text(doctorName, rightColX, footerY + 20, { width: W * 0.45, align: 'center' });

      if (rx.doctor_email) {
        doc.fontSize(7).font('Helvetica-Bold')
          .text(rx.doctor_email, rightColX, footerY + 32, { width: W * 0.45, align: 'center' });
      }

      // Código de verificación
      if (rx.verification_code) {
        doc.fontSize(7).font('Helvetica').fillColor('#888888')
          .text(
            `Código de verificación: ${rx.verification_code}`,
            rightColX, footerY + 44, { width: W * 0.45, align: 'center' },
          );
      }

      // Leyenda legal
      doc.fontSize(6).font('Helvetica').fillColor('#AAAAAA')
        .text(
          'Receta generada electrónicamente. Verificable en mediclick.art3d-studio.com.ar',
          LEFT, footerY + 60, { width: W, align: 'center' },
        );

      // Línea inferior decorativa
      doc.rect(LEFT, footerY + 72, W, 3).fill('#0097A7');

      doc.end();
    });
  }
}
