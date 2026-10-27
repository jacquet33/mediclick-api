import { Controller, Get, Post, Delete, Body, Param, ForbiddenException } from '@nestjs/common';
import { OrgId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';
import { DigitalSignatureService } from './digital-signature.service';

@Controller('api/v1')
export class DigitalSignatureController {
  constructor(private service: DigitalSignatureService) {}

  private medico(u: AuthUser) {
    if (u.userType !== 'doctor') throw new ForbiddenException('Solo para médicos');
    return u.doctorId;
  }

  /** Certificado de firma digital registrado (solo la parte pública) */
  @Get('digital-signature/certificate')
  certificado(@CurrentUser() u: AuthUser) {
    return this.service.certificado(this.medico(u));
  }

  /** POST { certPem, chainPem } — el navegador lo extrae del .p12/.pfx; la clave privada no se envía */
  @Post('digital-signature/certificate')
  registrar(@CurrentUser() u: AuthUser, @Body('certPem') certPem: string, @Body('chainPem') chainPem?: string) {
    return this.service.registrarCertificado(this.medico(u), certPem, chainPem);
  }

  @Delete('digital-signature/certificate')
  quitar(@CurrentUser() u: AuthUser) {
    return this.service.quitarCertificado(this.medico(u));
  }

  /** Paso 1 de la firma: devuelve los bytes del PDF a firmar */
  @Post('prescriptions/:id/digital-signature/start')
  iniciar(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.iniciar(orgId, this.medico(u), id);
  }

  /** Paso 2: { sessionId, cms } con la firma PKCS#7 hecha en el navegador */
  @Post('prescriptions/:id/digital-signature/complete')
  completar(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Param('id') id: string,
            @Body('sessionId') sessionId: string, @Body('cms') cms: string) {
    return this.service.completar(orgId, this.medico(u), id, sessionId, cms);
  }
}
