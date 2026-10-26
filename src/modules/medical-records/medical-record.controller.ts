import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Res, Header } from '@nestjs/common';
import { Request, Response } from 'express';
import { MedicalRecordService, CreateMedicalRecordDto } from './medical-record.service';
import { MedicalRecordPdfService } from './medical-record-pdf.service';
import { AuditService } from '../audit/audit.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/medical-records')
export class MedicalRecordController {
  constructor(
    private recordService: MedicalRecordService,
    private pdfService: MedicalRecordPdfService,
    private auditService: AuditService,
  ) {}

  @Get()
  async findByPatient(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Query('patient_id') patientId: string,
    @Req() req: Request,
  ) {
    const records = await this.recordService.findByPatient(orgId, patientId);
    // Log access to patient medical records (Ley 26.529 trazabilidad)
    this.auditService.logAccess(
      doctorId, 'doctor', 'VIEW_PATIENT_RECORDS',
      'medical_records', patientId,
      req.ip, req.headers['user-agent'] as string,
      { count: records.length },
    );
    return records;
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
