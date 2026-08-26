import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { PatientService, CreatePatientDto } from './patient.service';
import { OrgId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/patients')
export class PatientController {
  constructor(private patientService: PatientService) {}

  @Get()
  findAll(
    @OrgId() orgId: string,
    @Query('search') search?: string,
    @Query('updated_since') updatedSince?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.patientService.findAll(orgId, {
      search, updatedSince,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  @Get(':id')
  findById(@OrgId() orgId: string, @Param('id') id: string) {
    return this.patientService.findById(orgId, id);
  }

  @Get(':id/timeline')
  getTimeline(@OrgId() orgId: string, @Param('id') id: string) {
    return this.patientService.getTimeline(orgId, id);
  }

  @Post()
  create(@OrgId() orgId: string, @Body() dto: CreatePatientDto) {
    return this.patientService.create(orgId, dto);
  }

  @Put(':id')
  update(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: Partial<CreatePatientDto>) {
    return this.patientService.update(orgId, id, dto);
  }

  @Delete(':id')
  delete(@OrgId() orgId: string, @Param('id') id: string) {
    return this.patientService.delete(orgId, id);
  }
}
