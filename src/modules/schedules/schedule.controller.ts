import { Controller, Get, Put, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ScheduleService, SetScheduleDto, AddExceptionDto } from './schedule.service';
import { OrgId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/schedules')
export class ScheduleController {
  constructor(private scheduleService: ScheduleService) {}

  @Get()
  getSchedules(
    @OrgId() orgId: string,
    @Query('doctor_id') doctorId: string,
  ) {
    return this.scheduleService.getSchedules(orgId, doctorId);
  }

  @Put()
  setSchedules(@OrgId() orgId: string, @Body() dto: SetScheduleDto) {
    return this.scheduleService.setSchedules(orgId, dto);
  }

  @Get('exceptions')
  getExceptions(
    @OrgId() orgId: string,
    @Query('doctor_id') doctorId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.scheduleService.getExceptions(orgId, doctorId, from, to);
  }

  @Post('exceptions')
  addException(@OrgId() orgId: string, @Body() dto: AddExceptionDto) {
    return this.scheduleService.addException(orgId, dto);
  }

  @Delete('exceptions/:id')
  deleteException(@OrgId() orgId: string, @Param('id') id: string) {
    return this.scheduleService.deleteException(orgId, id);
  }
}
