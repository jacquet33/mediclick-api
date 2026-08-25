import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { AppointmentService, CreateAppointmentDto } from './appointment.service';

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
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Body() dto: CreateAppointmentDto & { forceCreate?: boolean },
  ) {
    const { forceCreate, ...appointmentDto } = dto;
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
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Query('date') date: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (from && to) {
      return this.apptService.getByDateRange(orgId, doctorId, from, to);
    }
    return this.apptService.getDailyAgenda(orgId, doctorId, date || new Date().toISOString().split('T')[0]);
  }

  /**
   * GET /appointments/full-day?date=2026-08-28
   * 
   * Vista panorámica: TODOS los turnos del doctor en TODAS
   * sus organizaciones, con alertas de superposición.
   */
  @Get('full-day')
  async getFullDay(
    @Headers('x-doctor-id') doctorId: string,
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
    @Headers('x-organization-id') orgId: string,
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
    @Headers('x-organization-id') orgId: string,
    @Body() body: { status: string; cancelReason?: string },
  ) {
    return this.apptService.updateStatus(id, orgId, body.status, body.cancelReason);
  }
}
