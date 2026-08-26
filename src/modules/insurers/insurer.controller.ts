import {
  Controller, Get, Post, Put, Body, Param, Query, Headers,
  BadRequestException,
} from '@nestjs/common';
import { InsurerService, InsurerRow } from './insurer.service';

@Controller('api/v1/insurers')
export class InsurerController {
  constructor(private insurers: InsurerService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('province') province?: string,
    @Query('kind') kind?: string,
    @Query('only_mapped') onlyMapped?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.insurers.list({
      search, province, kind,
      onlyMapped: onlyMapped === 'true',
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  @Get('provinces')
  provinces() {
    return this.insurers.provinces();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.insurers.findById(id);
  }

  @Post()
  create(@Body() dto: InsurerRow) {
    return this.insurers.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<InsurerRow>) {
    return this.insurers.update(id, dto);
  }

  /**
   * POST /insurers/import
   * Body: { csv: "..." }  o  { rows: [...] }
   * Ingiere el padrón RNOS de SSSalud.
   */
  @Post('import')
  async import(@Body() body: { csv?: string; rows?: InsurerRow[] }) {
    let rows: InsurerRow[];

    if (body.csv) {
      try {
        rows = this.insurers.parsePadronCsv(body.csv);
      } catch (err) {
        throw new BadRequestException(err.message);
      }
    } else if (body.rows?.length) {
      rows = body.rows;
    } else {
      throw new BadRequestException('Enviá el padrón en "csv" o en "rows"');
    }

    const summary = await this.insurers.importPadron(rows);
    const fallback = await this.insurers.ensureManualFallback();

    return { ...summary, manualConnectorsCreated: fallback.created, parsed: rows.length };
  }

  /** Le pone conector manual a los que no tienen ninguno */
  @Post('ensure-fallback')
  ensureFallback() {
    return this.insurers.ensureManualFallback();
  }

  /** Alta de conector para un financiador */
  @Post(':id/connectors')
  addConnector(
    @Param('id') id: string,
    @Body() dto: {
      adapterKey: string;
      kind: 'api' | 'portal' | 'manual' | 'offline';
      priority?: number;
      config?: Record<string, unknown>;
      canValidate?: boolean;
      canAuthorize?: boolean;
      canSubmitBatch?: boolean;
      isEnabled?: boolean;
    },
  ) {
    return this.insurers.upsertConnector(id, dto);
  }
}
