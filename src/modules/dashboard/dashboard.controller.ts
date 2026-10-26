import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get()
  getStats(@OrgId() orgId: string, @DoctorId() doctorId: string) {
    return this.dashboardService.getStats(orgId, doctorId);
  }
}
