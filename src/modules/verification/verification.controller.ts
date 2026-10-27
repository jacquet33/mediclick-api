import { Controller, Get, Post, Body, Param, Query, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';
import { VerificationService, SolicitudVerificacion } from './verification.service';

@Controller('api/v1/verification')
export class VerificationController {
  constructor(private service: VerificationService) {}

  private medico(u: AuthUser) {
    if (u.userType !== 'doctor') throw new ForbiddenException('Solo para médicos');
    return u.doctorId;
  }

  /** GET /verification — estado de la matrícula del médico logueado */
  @Get()
  estado(@CurrentUser() u: AuthUser) {
    return this.service.estado(this.medico(u));
  }

  /** POST /verification — envía DNI + matrícula (+ foto de la credencial) para verificar */
  @Post()
  solicitar(@CurrentUser() u: AuthUser, @Body() dto: SolicitudVerificacion) {
    return this.service.solicitar(this.medico(u), dto);
  }

  /** GET /verification/admin?estado=pending — cola para el administrador de la plataforma */
  @Get('admin')
  pendientes(@CurrentUser() u: AuthUser, @Query('estado') estado?: string) {
    return this.service.pendientes(this.medico(u), estado || 'pending');
  }

  @Post('admin/:doctorId/aprobar')
  aprobar(@CurrentUser() u: AuthUser, @Param('doctorId') id: string, @Body('nota') nota?: string) {
    return this.service.resolver(this.medico(u), id, true, nota);
  }

  @Post('admin/:doctorId/rechazar')
  rechazar(@CurrentUser() u: AuthUser, @Param('doctorId') id: string, @Body('nota') nota?: string) {
    return this.service.resolver(this.medico(u), id, false, nota);
  }
}
