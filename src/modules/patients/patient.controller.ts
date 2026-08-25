import { Controller, Get, Post, Put, Delete, Body, Param, Query, Headers } from '@nestjs/common';
import { PatientService, CreatePatientDto } from './patient.service';

@Controller('api/v1/patients')
export class PatientController {
  constructor(private patientService: PatientService) {}

  @Get()
  findAll(
    @Headers('x-organization-id') orgId: string,
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
  findById(@Headers('x-organization-id') orgId: string, @Param('id') id: string) {
    return this.patientService.findById(orgId, id);
  }

  @Get(':id/timeline')
  getTimeline(@Headers('x-organization-id') orgId: string, @Param('id') id: string) {
    return this.patientService.getTimeline(orgId, id);
  }

  @Post()
  create(@Headers('x-organization-id') orgId: string, @Body() dto: CreatePatientDto) {
    return this.patientService.create(orgId, dto);
  }

  @Put(':id')
  update(@Headers('x-organization-id') orgId: string, @Param('id') id: string, @Body() dto: Partial<CreatePatientDto>) {
    return this.patientService.update(orgId, id, dto);
  }

  @Delete(':id')
  delete(@Headers('x-organization-id') orgId: string, @Param('id') id: string) {
    return this.patientService.delete(orgId, id);
  }
}
