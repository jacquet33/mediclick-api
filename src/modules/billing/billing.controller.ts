import {
  Controller, Get, Post, Delete, Body, Param, Query, Res, Header,
} from '@nestjs/common';
import { Response } from 'express';
import { BillingService, BuildBatchDto, AddItemDto } from './billing.service';
import { OrgId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/billing')
export class BillingController {
  constructor(private billing: BillingService) {}

  @Get('batches')
  listBatches(
    @OrgId() orgId: string,
    @Query('year') year?: string,
    @Query('status') status?: string,
  ) {
    return this.billing.listBatches(orgId, {
      year: year ? parseInt(year) : undefined,
      status,
    });
  }

  @Get('batches/:id')
  getBatch(@OrgId() orgId: string, @Param('id') id: string) {
    return this.billing.getBatch(orgId, id);
  }

  /** Arma el lote del período con los turnos completados */
  @Post('batches/build')
  build(@OrgId() orgId: string, @Body() dto: BuildBatchDto) {
    return this.billing.buildBatch(orgId, dto);
  }

  /** Agrega una prestación al lote a mano */
  @Post('batches/:id/items')
  addItem(
    @OrgId() orgId: string,
    @Param('id') batchId: string,
    @Body() dto: AddItemDto,
  ) {
    return this.billing.addItem(orgId, batchId, dto);
  }

  @Delete('batches/:id/items/:itemId')
  removeItem(
    @OrgId() orgId: string,
    @Param('id') batchId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.billing.removeItem(orgId, batchId, itemId);
  }

  /** Corre la auditoría previa */
  @Post('batches/:id/audit')
  audit(@OrgId() orgId: string, @Param('id') id: string) {
    return this.billing.auditBatch(orgId, id);
  }

  /** Marca el lote como presentado (audita primero) */
  @Post('batches/:id/submit')
  submit(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body() body: { batchNumber?: string },
  ) {
    return this.billing.markSubmitted(orgId, id, body?.batchNumber);
  }

  /** Descarga el lote en CSV */
  @Get('batches/:id/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const csv = await this.billing.exportCsv(orgId, id);
    res.setHeader('Content-Disposition', `attachment; filename="lote-${id.slice(0, 8)}.csv"`);
    // BOM para que Excel abra los acentos bien
    res.send('\uFEFF' + csv);
  }
}
