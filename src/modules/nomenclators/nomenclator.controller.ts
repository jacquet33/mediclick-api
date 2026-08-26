import {
  Controller, Get, Post, Body, Param, Query, BadRequestException,
} from '@nestjs/common';
import { NomenclatorService, CreateNomenclatorDto, NomenclatorItemRow } from './nomenclator.service';
import { OrgId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/nomenclators')
export class NomenclatorController {
  constructor(private nomenclators: NomenclatorService) {}

  @Get()
  list(@OrgId() orgId: string, @Query('insurer_id') insurerId?: string) {
    return this.nomenclators.listVersions({ insurerId, organizationId: orgId });
  }

  @Get('search')
  search(
    @OrgId() orgId: string,
    @Query('insurer_id') insurerId: string,
    @Query('q') q: string,
    @Query('date') date?: string,
  ) {
    return this.nomenclators.search(
      insurerId, q, date ?? new Date().toISOString().slice(0, 10), orgId,
    );
  }

  @Get('lookup')
  lookup(
    @OrgId() orgId: string,
    @Query('insurer_id') insurerId: string,
    @Query('code') code: string,
    @Query('date') date?: string,
  ) {
    return this.nomenclators.lookupCode(
      insurerId, code, date ?? new Date().toISOString().slice(0, 10), orgId,
    );
  }

  @Get(':id')
  getVersion(@Param('id') id: string) {
    return this.nomenclators.getVersion(id);
  }

  @Post()
  create(@OrgId() orgId: string, @Body() dto: CreateNomenclatorDto) {
    return this.nomenclators.create({ ...dto, organizationId: dto.organizationId ?? orgId });
  }

  /**
   * POST /nomenclators/:id/import
   * Body: { csv: "..." } o { items: [...] }
   */
  @Post(':id/import')
  async import(
    @Param('id') id: string,
    @Body() body: { csv?: string; items?: NomenclatorItemRow[] },
  ) {
    let items: NomenclatorItemRow[];

    if (body.csv) {
      items = this.nomenclators.parseSheet(body.csv);
      if (!items.length) throw new BadRequestException('No se detectaron filas válidas en la planilla');
    } else if (body.items?.length) {
      items = body.items;
    } else {
      throw new BadRequestException('Enviá la planilla en "csv" o los items en "items"');
    }

    return this.nomenclators.importItems(id, items);
  }
}
