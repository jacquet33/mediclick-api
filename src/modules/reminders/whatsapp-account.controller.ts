import { Body, Controller, Delete, ForbiddenException, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';
import { WhatsappAccountService } from './whatsapp-account.service';

/** WhatsApp Business propio del médico: GET estado · POST conectar (registro integrado de Meta) · DELETE desconectar */
@Controller('api/v1/whatsapp/account')
export class WhatsappAccountController {
  constructor(private svc: WhatsappAccountService) {}
  private medico(u: AuthUser) { if (u.userType !== 'doctor') throw new ForbiddenException('Solo el médico conecta su WhatsApp'); return u.doctorId; }

  @Get() estado(@CurrentUser() u: AuthUser) { return this.svc.estado(this.medico(u)); }
  @Post() conectar(@CurrentUser() u: AuthUser, @Body() b: { code?: string; wabaId?: string; phoneNumberId?: string }) { return this.svc.conectar(this.medico(u), b); }
  @Delete() desconectar(@CurrentUser() u: AuthUser) { return this.svc.desconectar(this.medico(u)); }
}
