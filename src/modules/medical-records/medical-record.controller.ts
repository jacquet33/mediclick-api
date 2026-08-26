import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { MedicalRecordService, CreateMedicalRecordDto } from './medical-record.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/medical-records')
export class MedicalRecordController {
  constructor(private recordService: MedicalRecordService) {}

  @Get()
  findByPatient(
    @OrgId() orgId: string,
    @Query('patient_id') patientId: string,
  ) {
    return this.recordService.findByPatient(orgId, patientId);
  }

  @Get(':id')
  findById(@OrgId() orgId: string, @Param('id') id: string) {
    return this.recordService.findById(orgId, id);
  }

  @Post()
  create(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: CreateMedicalRecordDto,
  ) {
    return this.recordService.create(orgId, doctorId, dto);
  }

  @Put(':id')
  update(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateMedicalRecordDto>,
  ) {
    return this.recordService.update(orgId, id, dto);
  }
}
