import { Controller, Get, Post, Put, Body, Param, Query, Headers } from '@nestjs/common';
import { MedicalRecordService, CreateMedicalRecordDto } from './medical-record.service';

@Controller('api/v1/medical-records')
export class MedicalRecordController {
  constructor(private recordService: MedicalRecordService) {}

  @Get()
  findByPatient(
    @Headers('x-organization-id') orgId: string,
    @Query('patient_id') patientId: string,
  ) {
    return this.recordService.findByPatient(orgId, patientId);
  }

  @Get(':id')
  findById(@Headers('x-organization-id') orgId: string, @Param('id') id: string) {
    return this.recordService.findById(orgId, id);
  }

  @Post()
  create(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Body() dto: CreateMedicalRecordDto,
  ) {
    return this.recordService.create(orgId, doctorId, dto);
  }

  @Put(':id')
  update(
    @Headers('x-organization-id') orgId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateMedicalRecordDto>,
  ) {
    return this.recordService.update(orgId, id, dto);
  }
}
