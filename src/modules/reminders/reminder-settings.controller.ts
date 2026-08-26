import { Controller, Get, Put, Body } from '@nestjs/common';
import { ReminderSettingsService, UpdateReminderSettingsDto } from './reminder-settings.service';
import { DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/reminder-settings')
export class ReminderSettingsController {
  constructor(private service: ReminderSettingsService) {}

  @Get()
  async get(@DoctorId() doctorId: string) {
    return this.service.getSettings(doctorId);
  }

  @Put()
  async update(
    @DoctorId() doctorId: string,
    @Body() dto: UpdateReminderSettingsDto,
  ) {
    return this.service.updateSettings(doctorId, dto);
  }
}
