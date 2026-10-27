import { Controller, Get, Put, Post, Delete, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ScheduleService, SetScheduleDto, AddExceptionDto } from './schedule.service';
import { OrgId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';

@Controller('api/v1/schedules')
export class ScheduleController {
  constructor(private scheduleService: ScheduleService) {}

  @Get()
  getSchedules(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Query('doctor_id') doctorId: string,
  ) {
    return this.scheduleService.getSchedules(orgId, this.target(user, doctorId));
  }

  @Put()
  setSchedules(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: SetScheduleDto) {
    return this.scheduleService.setSchedules(orgId, { ...dto, doctorId: this.target(user, dto.doctorId) });
  }

  @Get('exceptions')
  getExceptions(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Query('doctor_id') doctorId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.scheduleService.getExceptions(orgId, this.target(user, doctorId), from, to);
  }

  @Post('exceptions')
  addException(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: AddExceptionDto) {
    return this.scheduleService.addException(orgId, { ...dto, doctorId: this.target(user, dto.doctorId) });
  }

  @Delete('exceptions/:id')
  deleteException(@OrgId() orgId: string, @Param('id') id: string) {
    return this.scheduleService.deleteException(orgId, id);
  }

  /**
   * Médico de la agenda: la secretaría elige el médico (doctor_id); un médico edita la suya.
   * (La pertenencia del médico al consultorio se valida en el servicio.)
   */
  private target(user: AuthUser, doctorId?: string): string {
    if (user.userType === 'staff') {
      if (!doctorId) throw new BadRequestException('Elegí el médico');
      return doctorId;
    }
    if (doctorId && doctorId !== user.doctorId && !['owner', 'admin'].includes(user.orgRole || '')) return user.doctorId;
    return doctorId || user.doctorId;
  }
}
