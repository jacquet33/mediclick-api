import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { AdminOnly } from '../../common/guards/auth.guard';
import { HubService } from './hub.service';
import {
  AffiliateQuery, PracticeAuthorizationRequest, BatchSubmission,
} from './adapters/adapter.interface';
import { OrgId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/hub')
export class HubController {
  constructor(private hub: HubService) {}

  /**
   * POST /hub/validate
   * Valida un afiliado. Misma llamada para las 300 obras sociales.
   */
  @Post('validate')
  validate(
    @OrgId() orgId: string,
    @Body() body: AffiliateQuery & { insurerId: string; skipCache?: boolean; patientId?: string },
  ) {
    const { insurerId, skipCache, patientId, ...query } = body;
    return this.hub.validateAffiliate(orgId, insurerId, query, { skipCache, patientId });
  }

  /**
   * POST /hub/authorize
   * Pide autorización de una práctica.
   */
  @Post('authorize')
  authorize(
    @OrgId() orgId: string,
    @Body() body: PracticeAuthorizationRequest & {
      insurerId: string; patientId?: string; appointmentId?: string;
    },
  ) {
    const { insurerId, patientId, appointmentId, ...req } = body;
    return this.hub.authorizePractice(orgId, insurerId, req, { patientId, appointmentId });
  }

  /**
   * POST /hub/batch
   * Presenta el lote de facturación del período.
   */
  @Post('batch')
  submitBatch(
    @OrgId() orgId: string,
    @Body() body: BatchSubmission & { insurerId: string },
  ) {
    const { insurerId, ...batch } = body;
    return this.hub.submitBatch(orgId, insurerId, batch);
  }

  /**
   * GET /hub/coverage
   * Qué obras sociales cubrimos y por qué vía.
   */
  @AdminOnly()
  @Get('coverage')
  coverage(
    @Query('province') province?: string,
    @Query('search') search?: string,
  ) {
    return this.hub.getCoverage({ province, search });
  }

  /**
   * GET /hub/resolve?q=OSDE
   * Resuelve texto libre a un financiador del padrón.
   */
  @Get('resolve')
  resolve(@Query('q') q: string) {
    return this.hub.resolveInsurer(q);
  }
}
