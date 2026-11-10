import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';
import { CoberturaService } from './cobertura.service';

/** Validación de cobertura en el padrón oficial: GET /cobertura/estado · POST /cobertura/consultar */
@Controller('api/v1/cobertura')
export class CoberturaController {
  constructor(private svc: CoberturaService) {}

  @Get('estado')
  estado() { return { disponible: this.svc.disponible }; }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('consultar')
  consultar(@CurrentUser() u: AuthUser, @OrgId() orgId: string, @Body() b: { dni?: string; sexo?: string; patientId?: string }) {
    return this.svc.consultar(String(b?.dni || ''), b?.sexo, u.doctorId || (u as any).staffId || (u as any).id, b?.patientId, orgId);
  }
}
