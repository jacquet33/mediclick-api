import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PatientService, CreatePatientDto } from './patient.service';
import { PatientHistoryService } from './patient-history.service';
import { AuditService } from '../audit/audit.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/patients')
export class PatientController {
  constructor(
    private patientService: PatientService,
    private historyService: PatientHistoryService,
    private auditService: AuditService,
  ) {}

  @Get()
  findAll(
    @OrgId() orgId: string,
    @Query('search') search?: string,
    @Query('updated_since') updatedSince?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.patientService.findAll(orgId, {
      search, updatedSince,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  /** Obras sociales con las que trabaja el consultorio */
  @Get('insurers')
  insurersInUse(@OrgId() orgId: string) {
    return this.patientService.insurersInUse(orgId);
  }

  @Get(':id/history')
  async getHistory(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const history = await this.historyService.getFullHistory(orgId, id);
    this.auditService.logAccess(
      doctorId, 'doctor', 'VIEW_PATIENT_HISTORY',
      'patients', id,
      req.ip, req.headers['user-agent'] as string,
    );
    return history;
  }

  @Get(':id')
  async findById(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const patient = await this.patientService.findById(orgId, id);
    this.auditService.logAccess(
      doctorId, 'doctor', 'VIEW_PATIENT',
      'patients', id,
      req.ip, req.headers['user-agent'] as string,
    );
    return patient;
  }

  @Get(':id/timeline')
  getTimeline(@OrgId() orgId: string, @Param('id') id: string) {
    return this.patientService.getTimeline(orgId, id);
  }

  @Post()
  create(@OrgId() orgId: string, @Body() dto: CreatePatientDto) {
    return this.patientService.create(orgId, dto);
  }

  @Put(':id')
  update(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: Partial<CreatePatientDto>) {
    return this.patientService.update(orgId, id, dto);
  }

  @Delete(':id')
  delete(@OrgId() orgId: string, @Param('id') id: string) {
    return this.patientService.delete(orgId, id);
  }
}
