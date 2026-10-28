import { Controller, Get, Post, Patch, Body, Param, Query, Res, Header, BadRequestException } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { FhirService } from './fhir.service';
import { Public } from '../../common/guards/auth.guard';
import { PrescriptionService, CreatePrescriptionDto } from './prescription.service';
import { PrescriptionPdfService } from './prescription-pdf.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';
import { Response } from 'express';

@Controller('api/v1/prescriptions')
export class PrescriptionController {
  constructor(
    private rxService: PrescriptionService,
    private pdfService: PrescriptionPdfService,
    private emailService: EmailService,
    private fhir: FhirService,
  ) {}

  /** GET /prescriptions/frequent — medicamentos que más receta el médico */
  @Get('frequent')
  frecuentes(@DoctorId() doctorId: string) {
    return this.rxService.frecuentes(doctorId);
  }

  /** GET /prescriptions/metrics — tiempo promedio por receta */
  @Get('metrics')
  metricas(@DoctorId() doctorId: string) {
    return this.rxService.metricas(doctorId);
  }

  /** GET /prescriptions/patient/:patientId/recent — últimas recetas con medicamentos (para repetir) */
  @Get('patient/:patientId/recent')
  recientes(@OrgId() orgId: string, @Param('patientId') patientId: string) {
    return this.rxService.ultimasDelPaciente(orgId, patientId);
  }

  /** GET /prescriptions/:id/fhir — receta en HL7 FHIR R4 */
  @Get(':id/fhir')
  async fhirBundle(@OrgId() orgId: string, @Param('id') id: string) {
    await this.rxService.findById(orgId, id);
    return this.fhir.bundle(id);
  }

  /** POST /prescriptions/:id/email { email? } — manda el PDF de la receta (por defecto al email del paciente) */
  @Post(':id/email')
  async email(@OrgId() orgId: string, @Param('id') id: string, @Body('email') email?: string) {
    const rx = await this.rxService.findById(orgId, id);
    const to = (email || rx.patient_email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new BadRequestException('Indicá un email válido');
    const buffer = (await this.rxService.signedPdf(id)) || await this.pdfService.generatePdf(orgId, id);
    const base = process.env.BASE_URL || 'https://tuconsultorio.rispy.io';
    const sent = await this.emailService.sendWithAttachment({
      to,
      subject: `Receta — Dr/a. ${rx.doctor_name}`,
      html: this.emailService.wrapTemplate(`
        <h2 style="color:#2B241F;margin-bottom:12px;">Tu receta electrónica</h2>
        <p>Hola ${rx.patient_name}, te enviamos la receta indicada por Dr/a. ${rx.doctor_name}.</p>
        <p>Podés presentarla en la farmacia desde el celular o impresa. Código de verificación: <b>${rx.verification_code}</b></p>
        <p><a href="${base}/verificar-receta?code=${rx.verification_code}">Verificar la receta</a></p>
      `),
      attachments: [{ filename: `receta-${rx.verification_code}.pdf`, content: buffer, contentType: 'application/pdf' }],
    });
    return { sent, to };
  }

  @Get()
  findAll(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Query('patient_id') patientId?: string,
    @Query('status') status?: string,
    @Query('updated_since') updatedSince?: string,
  ) {
    return this.rxService.findAll(orgId, doctorId, { patientId, status, updatedSince });
  }

  @Public()
  @Get('verify/:code')
  verify(@Param('code') code: string) {
    return this.rxService.verify(code);
  }

  @Public()
  @Get('verify/:code/pdf')
  async verifyAndDownloadPdf(
    @Param('code') code: string,
    @Res() res: Response,
  ) {
    try {
      const rx = await this.rxService.verify(code, true);
      if (!rx) return res.status(404).json({ message: 'Receta no encontrada' });
      const buffer = (await this.rxService.signedPdf(rx.id)) || await this.pdfService.generatePdf(rx.organization_id, rx.id);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="receta-${code}.pdf"`,
        'Content-Length': buffer.length,
      });
      res.end(buffer);
    } catch (e) {
      res.status(500).json({ message: e.message || 'Error generando PDF' });
    }
  }

  @Get(':id/pdf')
  async downloadPdf(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      await this.rxService.findById(orgId, id);
      const buffer = (await this.rxService.signedPdf(id)) || await this.pdfService.generatePdf(orgId, id);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="receta-${id.slice(0, 8)}.pdf"`,
        'Content-Length': buffer.length,
      });
      res.end(buffer);
    } catch (e) {
      console.error(`PDF error: ${e.message}`, e.stack);
      res.status(500).json({ message: 'Error generando el PDF' });
    }
  }

  @Get(':id')
  findById(@OrgId() orgId: string, @Param('id') id: string) {
    return this.rxService.findById(orgId, id);
  }

  @Post()
  create(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.rxService.create(orgId, doctorId, dto);
  }

  @Patch(':id/cancel')
  cancel(@OrgId() orgId: string, @Param('id') id: string) {
    return this.rxService.cancel(orgId, id);
  }
}
