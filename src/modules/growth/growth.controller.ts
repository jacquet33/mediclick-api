import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { GrowthService } from './growth.service';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';

@Controller('api/v1')
export class GrowthController {
  constructor(private g: GrowthService) {}

  /** POST /patients/import { rows: [{firstName,lastName,dni,phone,email,dateOfBirth,gender,insuranceProvider,insuranceNumber,address,city,notes}] } */
  @Post('patients/import')
  importar(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Body() b: { rows?: any[] }) {
    if (u.userType === 'patient') throw new ForbiddenException();
    return this.g.importarPacientes(orgId, u.userType === 'doctor' ? u.doctorId : (null as any), b?.rows || []);
  }

  @Get('referrals/me')
  miCodigo(@CurrentUser() u: AuthUser) {
    if (u.userType !== 'doctor') throw new ForbiddenException('Solo para médicos');
    return this.g.miCodigo(u.doctorId);
  }

  @Post('referrals/claim')
  reclamar(@CurrentUser() u: AuthUser, @Body() b: { code?: string }) {
    if (u.userType !== 'doctor') throw new ForbiddenException('Solo para médicos');
    return this.g.reclamar(u.doctorId, String(b?.code || ''));
  }

  @Get('metrics/time-saved')
  metricas(@OrgId() orgId: string, @CurrentUser() u: AuthUser) {
    if (u.userType !== 'doctor') throw new ForbiddenException('Solo para médicos');
    return this.g.metricas(u.doctorId, orgId);
  }
}
