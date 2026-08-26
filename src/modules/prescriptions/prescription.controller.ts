import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard';
import { PrescriptionService, CreatePrescriptionDto } from './prescription.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/prescriptions')
export class PrescriptionController {
  constructor(private rxService: PrescriptionService) {}

  @Get()
  findAll(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Query('patient_id') patientId?: string,
    @Query('status') status?: string,
    @Query('updated_since') updatedSince?: string,
  ) {
    return this.rxService.findAll(orgId, doctorId, { patientId, status, updatedSince });
  }

  @Public()
  @Get('verify/:code')
  verify(@Param('code') code: string) {
    return this.rxService.verify(code);
  }

  @Get(':id')
  findById(@OrgId() orgId: string, @Param('id') id: string) {
    return this.rxService.findById(orgId, id);
  }

  @Post()
  create(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.rxService.create(orgId, doctorId, dto);
  }

  @Patch(':id/cancel')
  cancel(@OrgId() orgId: string, @Param('id') id: string) {
    return this.rxService.cancel(orgId, id);
  }
}
