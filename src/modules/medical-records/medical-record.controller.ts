import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Res, BadRequestException } from '@nestjs/common';
import { Request, Response } from 'express';
import { MedicalRecordService, CreateMedicalRecordDto } from './medical-record.service';
import { MedicalRecordPdfService } from './medical-record-pdf.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/medical-records')
export class MedicalRecordController {
  constructor(
    private recordService: MedicalRecordService,
    private pdfService: MedicalRecordPdfService,
    private auditService: AuditService,
    private emailService: EmailService,
  ) {}

  @Get()
  async findByPatient(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Query('patient_id') patientId: string,
    @Query('date_from') dateFrom: string,
    @Query('date_to') dateTo: string,
    @Query('record_type') recordType: string,
    @Query('search') search: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @Req() req: Request,
  ) {
    // Si vienen filtros, usar consulta filtrada con paginación
    const hasFilters = dateFrom || dateTo || recordType || search || limit || offset;
    if (hasFilters) {
      const result = await this.recordService.findByPatientFiltered(orgId, patientId, {
        dateFrom,
        dateTo,
        recordType,
        search,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });
      this.auditService.logAccess(
        doctorId, 'doctor', 'VIEW_PATIENT_RECORDS',
        'medical_records', patientId,
        req.ip, req.headers['user-agent'] as string,
        { count: result.records.length, total: result.total, filters: { dateFrom, dateTo, recordType, search } },
      );
      return result;
    }

    const records = await this.recordService.findByPatient(orgId, patientId);
    this.auditService.logAccess(
      doctorId, 'doctor', 'VIEW_PATIENT_RECORDS',
      'medical_records', patientId,
      req.ip, req.headers['user-agent'] as string,
      { count: records.length },
    );
    return records;
  }

  /**
   * GET /api/v1/medical-records/patient/:patientId/timeline
   * Timeline cronológico de la HC del paciente.
   */
  @Get('patient/:patientId/timeline')
  async getTimeline(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('patientId') patientId: string,
    @Req() req: Request,
  ) {
    const timeline = await this.recordService.getPatientTimeline(orgId, patientId);
    this.auditService.logAccess(
      doctorId, 'doctor', 'VIEW_PATIENT_TIMELINE',
      'medical_records', patientId,
      req.ip, req.headers['user-agent'] as string,
    );
    return timeline;
  }

  @Get(':id')
  async findById(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const record = await this.recordService.findById(orgId, id);
    // Log individual record access
    this.auditService.logAccess(
      doctorId, 'doctor', 'VIEW_RECORD',
      'medical_records', id,
      req.ip, req.headers['user-agent'] as string,
    );
    return record;
  }

  /**
   * GET /api/v1/medical-records/patient/:patientId/pdf
   * Descarga la Historia Clínica completa del paciente en PDF.
   * Ley 26.529 — el paciente tiene derecho a recibir copia de su HC.
   */
  @Get('patient/:patientId/pdf')
  async downloadPatientHistory(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('patientId') patientId: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const { buffer, filename } = await this.pdfService.generatePatientHistoryPdf(orgId, doctorId, patientId);

    // Log PDF generation (Ley 26.529 trazabilidad)
    this.auditService.logAccess(
      doctorId, 'doctor', 'EXPORT_PATIENT_HC_PDF',
      'medical_records', patientId,
      req.ip, req.headers['user-agent'] as string,
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /**
   * POST /api/v1/medical-records/patient/:patientId/pdf/email
   * Envía la HC completa en PDF por email a la obra social u otro destinatario.
   * Body: { email: string, subject?: string, message?: string }
   */
  @Post('patient/:patientId/pdf/email')
  async emailPatientHistory(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('patientId') patientId: string,
    @Body() body: { email: string; subject?: string; message?: string },
    @Req() req: Request,
  ) {
    if (!body.email) {
      throw new BadRequestException('El campo email es obligatorio');
    }

    const { buffer, filename } = await this.pdfService.generatePatientHistoryPdf(orgId, doctorId, patientId);

    // Obtener datos del paciente para el asunto
    const patient = await this.recordService.findPatientBasic(orgId, patientId);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Paciente';

    const subject = body.subject || `Historia Clínica — ${patientName}`;
    const message = body.message || `Adjunto la Historia Clínica completa de ${patientName}.`;

    const sent = await this.emailService.sendWithAttachment({
      to: body.email,
      subject,
      html: this.emailService.wrapTemplate(`
        <h2 style="color:#161925;margin-bottom:16px;">Historia Clínica</h2>
        <p>${message}</p>
        <div style="background:#FFF7F3;border-radius:12px;padding:20px;margin:16px 0;">
          <p style="margin:4px 0;"><strong>Paciente:</strong> ${patientName}</p>
          <p style="margin:4px 0;"><strong>DNI:</strong> ${patient?.dni || '—'}</p>
          <p style="margin:4px 0;"><strong>Obra Social:</strong> ${patient?.insurance_provider || '—'}</p>
          <p style="margin:4px 0;"><strong>N° Afiliado:</strong> ${patient?.insurance_number || '—'}</p>
        </div>
        <p style="color:#666;font-size:13px;">
          Este documento fue generado digitalmente por MediClick.<br>
          Conforme Ley 26.529 y Ley 25.326.
        </p>
      `),
      attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
    });

    // Log email send (Ley 26.529 trazabilidad)
    this.auditService.logAccess(
      doctorId, 'doctor', 'EMAIL_PATIENT_HC_PDF',
      'medical_records', patientId,
      req.ip, req.headers['user-agent'] as string,
      { recipientEmail: body.email, filename },
    );

    return { sent, message: sent ? `HC enviada a ${body.email}` : 'Error al enviar el email' };
  }

  @Post()
  async create(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: CreateMedicalRecordDto,
    @Req() req: Request,
  ) {
    const record = await this.recordService.create(orgId, doctorId, dto);
    this.auditService.logAccess(
      doctorId, 'doctor', 'CREATE_RECORD',
      'medical_records', record.id,
      req.ip, req.headers['user-agent'] as string,
    );
    return record;
  }

  @Put(':id')
  async update(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateMedicalRecordDto>,
    @Req() req: Request,
  ) {
    const record = await this.recordService.update(orgId, id, dto);
    this.auditService.logAccess(
      doctorId, 'doctor', 'UPDATE_RECORD',
      'medical_records', id,
      req.ip, req.headers['user-agent'] as string,
    );
    return record;
  }

  @Delete(':id')
  async softDelete(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const record = await this.recordService.softDelete(orgId, id, doctorId);
    this.auditService.logAccess(
      doctorId, 'doctor', 'DELETE_RECORD',
      'medical_records', id,
      req.ip, req.headers['user-agent'] as string,
    );
    return record;
  }
}
