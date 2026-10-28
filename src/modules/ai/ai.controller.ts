import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';

/** Asistente del médico: siempre devuelve borradores para revisar */
@Controller('api/v1/ai')
export class AiController {
  constructor(private ai: AiService) {}

  private medico(u: AuthUser) {
    if (u.userType !== 'doctor') throw new ForbiddenException('El asistente clínico es solo para médicos');
  }

  @Get('status')
  estado(@CurrentUser() u: AuthUser) {
    this.medico(u);
    return this.ai.estado();
  }

  @Post('patients/:id/summary')
  resumen(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    this.medico(u);
    return this.ai.resumen(orgId, u.doctorId, id);
  }

  @Post('records/:id/instructions')
  indicaciones(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    this.medico(u);
    return this.ai.indicaciones(orgId, u.doctorId, id);
  }

  @Post('dictation')
  dictado(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Body() b: { text?: string; patientId?: string }) {
    this.medico(u);
    return this.ai.ordenarDictado(orgId, u.doctorId, String(b?.text || ''), b?.patientId);
  }
}
