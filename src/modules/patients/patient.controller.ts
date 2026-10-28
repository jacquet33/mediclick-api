import { ForbiddenException, Controller, Get, Post, Put, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PatientService } from './patient.service';
import { CreatePatientDto } from '../../common/dto/patient.dto';
import { PatientHistoryService } from './patient-history.service';
import { AuditService } from '../audit/audit.service';
import { OrgId, DoctorId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';

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

  /** GET /patients/:id/ficha — todo lo cargado del paciente (la secretaría no ve lo clínico) */
  @Get(':id/ficha')
  async ficha(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const clinico = user.userType === 'doctor';
    const data = await this.patientService.getFicha(orgId, id, clinico);
    this.auditService.logAccess(
      user.doctorId, clinico ? 'doctor' : 'secretary', clinico ? 'VIEW_PATIENT_HISTORY' : 'VIEW_PATIENT',
      'patients', id, req.ip, req.headers['user-agent'] as string,
    );
    return data;
  }

  /** PUT /patients/:id/clinical-summary — alergias, problemas activos, medicación actual y antecedentes (solo el médico) */
  @Put(':id/clinical-summary')
  async resumenClinico(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any, @Req() req: Request) {
    if (user.userType !== 'doctor') throw new ForbiddenException('Solo el médico edita el resumen clínico');
    const r = await this.patientService.setResumenClinico(orgId, id, user.doctorId, body || {});
    this.auditService.logAccess(user.doctorId, 'doctor', 'UPDATE_CLINICAL_SUMMARY', 'patients', id, req.ip, req.headers['user-agent'] as string);
    return r;
  }

  /** PUT /patients/:id/photo { photo: 'data:image/jpeg;base64,...' } — vacío para quitarla */
  @Put(':id/photo')
  setPhoto(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body('photo') photo: string) {
    return this.patientService.setPhoto(orgId, id, photo, user.doctorId);
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
