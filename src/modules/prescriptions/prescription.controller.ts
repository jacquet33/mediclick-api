import { Controller, Get, Post, Patch, Body, Param, Query, Headers } from '@nestjs/common';
import { PrescriptionService, CreatePrescriptionDto } from './prescription.service';

@Controller('api/v1/prescriptions')
export class PrescriptionController {
  constructor(private rxService: PrescriptionService) {}

  @Get()
  findAll(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Query('patient_id') patientId?: string,
    @Query('status') status?: string,
    @Query('updated_since') updatedSince?: string,
  ) {
    return this.rxService.findAll(orgId, doctorId, { patientId, status, updatedSince });
  }

  @Get('verify/:code')
  verify(@Param('code') code: string) {
    return this.rxService.verify(code);
  }

  @Get(':id')
  findById(@Headers('x-organization-id') orgId: string, @Param('id') id: string) {
    return this.rxService.findById(orgId, id);
  }

  @Post()
  create(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.rxService.create(orgId, doctorId, dto);
  }

  @Patch(':id/cancel')
  cancel(@Headers('x-organization-id') orgId: string, @Param('id') id: string) {
    return this.rxService.cancel(orgId, id);
  }
}
