import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { WhatsappReminderService } from './whatsapp-reminder.service';
import { AppointmentService } from '../appointments/appointment.service';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';

/** Recordatorios por WhatsApp del consultorio (médico y secretaría) */
@Controller('api/v1/reminders/whatsapp')
export class WhatsappReminderController {
  constructor(private wa: WhatsappReminderService, private appts: AppointmentService) {}

  /** GET /reminders/whatsapp/config — modo del médico (manual | auto) */
  @Get('config')
  getConfig(@CurrentUser() user: AuthUser) {
    if (user.userType !== 'doctor') return { modo: 'manual', todos: true, automaticoDisponible: this.wa.habilitado };
    return this.wa.getModo(user.doctorId);
  }

  @Put('config')
  setConfig(@CurrentUser() user: AuthUser, @Body() body: { modo?: string; todos?: boolean }) {
    if (user.userType !== 'doctor') throw new ForbiddenException('Solo el médico configura sus recordatorios');
    return this.wa.setModo(user.doctorId, body?.modo, body?.todos);
  }

  /** GET /reminders/whatsapp/pendientes?date=YYYY-MM-DD (por defecto, mañana) */
  @Get('pendientes')
  async pendientes(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Query('date') date?: string, @Query('doctor_id') doctorId?: string) {
    if (user.userType === 'patient') throw new ForbiddenException();
    const ids = await this.appts.visibleOrgDoctorIds(orgId, user as any, doctorId);
    return this.wa.pendientes(orgId, ids, date);
  }

  /** POST /reminders/whatsapp/:id/enviado — marca el recordatorio como enviado a mano ({ enviado:false } lo desmarca) */
  @Post(':id/enviado')
  marcar(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { enviado?: boolean }) {
    if (user.userType === 'patient') throw new ForbiddenException();
    return this.wa.marcarEnviado(orgId, id, user.doctorId, body?.enviado !== false);
  }
}
