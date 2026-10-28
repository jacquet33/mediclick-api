import { Controller, ForbiddenException, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ActivityService } from './activity.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser, Public } from '../../common/guards/auth.guard';

@Controller('api/v1/admin/activity')
export class AdminActivityController {
  constructor(private act: ActivityService) {}

  /** GET /admin/activity — altas, médicos con alta incompleta y accesos recientes (solo administradores) */
  @Get()
  panel(@CurrentUser() u: AuthUser) {
    if (u.userType !== 'doctor') throw new ForbiddenException();
    return this.act.panel(u.doctorId);
  }
}

@Public()
@Controller('api/v1/public/onboarding')
export class OnboardingPublicController {
  constructor(private act: ActivityService) {}

  /** Link "No quiero recibir más estos avisos" del email de alta incompleta */
  @Get('baja')
  async baja(@Query('d') d: string, @Query('t') t: string, @Res() res: Response) {
    const ok = await this.act.desuscribir(String(d || ''), String(t || '')).catch(() => false);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TuConsultorioOnline</title>
<body style="font-family:system-ui,sans-serif;background:#F5F1EA;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="background:#fff;border-radius:16px;padding:28px;max-width:420px;text-align:center;color:#2B241F">
<h1 style="font-size:20px">${ok ? 'Listo, no te vamos a escribir más' : 'El enlace no es válido'}</h1>
<p style="color:#7A6E62">${ok ? 'No vas a recibir más recordatorios para completar el alta. Si querés terminarla, entrá cuando quieras.' : 'Escribinos a contact@rispy.io y lo resolvemos.'}</p>
<a href="/portal" style="display:inline-block;margin-top:8px;background:#9A6B3F;color:#fff;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:700">Ir a TuConsultorioOnline</a></div></body>`);
  }
}
