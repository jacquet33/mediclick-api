import { Controller, Get } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/onboarding')
export class OnboardingController {
  constructor(private onboardingService: OnboardingService) {}

  @Get('status')
  getStatus(@DoctorId() doctorId: string) {
    return this.onboardingService.getStatus(doctorId);
  }
}
