import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { MedicalRecordService, CreateMedicalRecordDto } from './medical-record.service';
import { AuditService } from '../audit/audit.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/medical-records')
export class MedicalRecordController {
  constructor(
    private recordService: MedicalRecordService,
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
