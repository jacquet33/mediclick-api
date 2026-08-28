import { Controller, Post, Delete, Get, Body, Param, Query } from '@nestjs/common';
import { PushNotificationService } from './push.service';
import { Public } from '../../common/guards/auth.guard';

@Controller('api/v1/push')
export class PushController {
  constructor(private pushService: PushNotificationService) {}

  /** Registrar device token (llamado desde la app al obtener permiso de push) */
  @Post('register')
  register(@Body() body: {
    userType: 'doctor' | 'patient' | 'staff';
    userId: string;
    token: string;
    platform: 'ios' | 'android' | 'web';
    deviceName?: string;
    appVersion?: string;
    osVersion?: string;
  }) {
    return this.pushService.registerToken(
      body.userType, body.userId, body.token, body.platform,
      { deviceName: body.deviceName, appVersion: body.appVersion, osVersion: body.osVersion },
    );
  }

  /** Desregistrar token (logout o desinstalación) */
  @Delete('unregister')
  unregister(@Body() body: { token: string }) {
    return this.pushService.unregisterToken(body.token);
  }

  /** Enviar push de prueba */
  @Post('test')
  async testPush(@Body() body: {
    userType: 'doctor' | 'patient' | 'staff';
    userId: string;
    title?: string;
    body?: string;
  }) {
    const payload = {
      title: body.title || '🔔 Notificación de prueba',
      body: body.body || 'Si ves esto, las push notifications funcionan.',
      category: 'test',
    };

    if (body.userType === 'doctor') return this.pushService.sendToDoctor(body.userId, payload);
    if (body.userType === 'patient') return this.pushService.sendToPatient(body.userId, payload);
    return this.pushService.sendToStaff(body.userId, payload);
  }

  /** Stats de notificaciones */
  @Get('stats')
  stats(@Query('type') type?: string, @Query('id') id?: string) {
    return this.pushService.getStats(type, id);
  }
}
