import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { PrescriptionTemplateService, CreateTemplateDto } from './prescription-template.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/prescription-templates')
export class PrescriptionTemplateController {
  constructor(private service: PrescriptionTemplateService) {}

  @Get()
  list(
    @DoctorId() doctorId: string,
    @OrgId() orgId: string,
    @Query('category') category?: string,
  ) {
    return this.service.list(doctorId, orgId, category);
  }

  @Get('categories')
  categories(@DoctorId() doctorId: string, @OrgId() orgId: string) {
    return this.service.listCategories(doctorId, orgId);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  create(
    @DoctorId() doctorId: string,
    @OrgId() orgId: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.service.create(doctorId, orgId, dto);
  }

  @Put(':id')
  update(
    @DoctorId() doctorId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateTemplateDto>,
  ) {
    return this.service.update(id, doctorId, dto);
  }

  @Delete(':id')
  delete(@DoctorId() doctorId: string, @Param('id') id: string) {
    return this.service.delete(id, doctorId);
  }
}
