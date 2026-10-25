import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { ConsentService, CreateConsentDto } from './consent.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/consents')
export class ConsentController {
  constructor(private consentService: ConsentService) {}

  @Post()
  create(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: CreateConsentDto,
  ) {
    return this.consentService.create(orgId, doctorId, dto);
  }

  @Get()
  findByPatient(
    @OrgId() orgId: string,
    @Query('patient_id') patientId: string,
  ) {
    return this.consentService.findByPatient(orgId, patientId);
  }

  @Get('check/:patientId')
  async hasActiveConsent(
    @OrgId() orgId: string,
    @Param('patientId') patientId: string,
  ) {
    const hasConsent = await this.consentService.hasActiveConsent(orgId, patientId);
    return { hasConsent };
  }

  @Get('default-text')
  getDefaultText() {
    return { text: this.consentService.getDefaultConsentText() };
  }

  @Put(':id/revoke')
  revoke(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.consentService.revoke(orgId, id, reason);
  }
}
