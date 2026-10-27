import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AppointmentService } from '../appointments/appointment.service';
import { OrgId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';

@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService, private appts: AppointmentService) {}

  /** GET /dashboard?doctor_id= — médico: su agenda; dueño o secretaría: todo el consultorio (o el médico elegido) */
  @Get()
  async getStats(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Query('doctor_id') doctorId?: string) {
    const ids = await this.appts.visibleOrgDoctorIds(orgId, user, doctorId);
    return this.dashboardService.getStats(orgId, ids);
  }
}
