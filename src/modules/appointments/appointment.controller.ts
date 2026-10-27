import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto, UpdateAppointmentStatusDto } from '../../common/dto/appointment.dto';
import { OrgId, DoctorId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';

@Controller('api/v1/appointments')
export class AppointmentController {
  constructor(private apptService: AppointmentService) {}

  /**
   * POST /appointments
   * 
   * Crear turno con validación cross-consultorio.
   * Si hay conflicto, devuelve 409 con detalle.
   * Enviar forceCreate: true para forzar la creación.
   * 
   * Response 201: turno creado
   * Response 409: { message, conflicts[], conflictSummary[], hint }
   */
  @Post()
  async create(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: CreateAppointmentDto & { forceCreate?: boolean },
  ) {
    const { forceCreate, ...appointmentDto } = dto;
    // Las apps no mandan doctorId: por defecto es el médico que inició sesión
    if (!appointmentDto.doctorId) appointmentDto.doctorId = doctorId;
    return this.apptService.create(orgId, doctorId, 'doctor', appointmentDto, forceCreate);
  }

  /**
   * GET /appointments?date=2026-08-28
   * 
   * Agenda del día en esta org.
   * Incluye bloques de otras orgs (sin datos de pacientes).
   */
  @Get()
  async getByDate(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @CurrentUser() user: AuthUser,
    @Query('date') date: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('doctor_id') filterDoctor?: string,
  ) {
    // Secretaría (o pedido explícito de otro médico): agenda de todo el consultorio
    if (user.userType === 'staff' || filterDoctor) {
      const ids = await this.apptService.visibleOrgDoctorIds(orgId, user, filterDoctor);
      if (from && to) return (await this.apptService.listByStatus(orgId, ids, { from, to, limit: 500 })).appointments;
      return this.apptService.getOrgDailyAgenda(orgId, ids, date || new Date().toISOString().split('T')[0]);
    }
    if (from && to) {
      return this.apptService.getByDateRange(orgId, doctorId, from, to);
    }
    return this.apptService.getDailyAgenda(orgId, doctorId, date || new Date().toISOString().split('T')[0]);
  }

  /**
   * GET /appointments/list?status=pending,pending_approval&from=&to=&doctor_id=&q=
   * Turnos por estado. La secretaría y el dueño ven todo el consultorio; un médico, su agenda.
   */
  @Get('list')
  async list(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('doctor_id') filterDoctor?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const ids = await this.apptService.visibleOrgDoctorIds(orgId, user, filterDoctor);
    return this.apptService.listByStatus(orgId, ids, { status, from, to, q, limit: limit ? parseInt(limit, 10) : undefined });
  }

  /** GET /appointments/counts?from=&to=&doctor_id= → { pending: 3, confirmed: 10, ... } */
  @Get('counts')
  async counts(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('doctor_id') filterDoctor?: string,
  ) {
    const ids = await this.apptService.visibleOrgDoctorIds(orgId, user, filterDoctor);
    return this.apptService.countsByStatus(orgId, ids, from, to);
  }

  /**
   * GET /appointments/full-day?date=2026-08-28
   * 
   * Vista panorámica: TODOS los turnos del doctor en TODAS
   * sus organizaciones, con alertas de superposición.
   */
  @Get('full-day')
  async getFullDay(
    @DoctorId() doctorId: string,
    @Query('date') date: string,
  ) {
    return this.apptService.getDoctorFullDay(doctorId, date || new Date().toISOString().split('T')[0]);
  }

  /**
   * GET /appointments/available-slots?doctor_id=UUID&date=2026-08-28
   * 
   * Slots disponibles considerando TODAS las orgs.
   * Cada slot dice si está libre, y si está ocupado, en qué org.
   */
  @Get('available-slots')
  async getAvailableSlots(
    @OrgId() orgId: string,
    @Query('doctor_id') doctorId: string,
    @Query('date') date: string,
  ) {
    return this.apptService.getAvailableSlots(orgId, doctorId, date);
  }

  /**
   * GET /appointments/check-conflict
   * 
   * Verificar si un horario tiene conflicto ANTES de crear.
   * Para mostrar warning en la UI en tiempo real.
   */
  @Get('check-conflict')
  async checkConflict(
    @Query('doctor_id') doctorId: string,
    @Query('date') date: string,
    @Query('start_time') startTime: string,
    @Query('end_time') endTime: string,
  ) {
    return this.apptService.checkConflicts(doctorId, date, startTime, endTime);
  }

  /**
   * PATCH /appointments/:id/status
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @OrgId() orgId: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.apptService.updateStatus(id, orgId, dto.status, dto.cancelReason);
  }

  /** Mismo cambio de estado por PUT: las apps de iOS publicadas lo llaman así. */
  @Put(':id/status')
  async updateStatusPut(
    @Param('id') id: string,
    @OrgId() orgId: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.apptService.updateStatus(id, orgId, dto.status, dto.cancelReason);
  }
}
