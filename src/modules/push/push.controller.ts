import { Controller, Post, Delete, Get, Body, Param, Query } from '@nestjs/common';
import { PushNotificationService } from './push.service';
import { Public } from '../../common/guards/auth.guard';
import { RegisterPushDto, UnregisterPushDto, TestPushDto } from '../../common/dto/push.dto';

@Controller('api/v1/push')
export class PushController {
  constructor(private pushService: PushNotificationService) {}

  /** Registrar device token (llamado desde la app al obtener permiso de push) */
  @Post('register')
  register(@Body() dto: RegisterPushDto) {
    return this.pushService.registerToken(
      dto.userType as 'doctor' | 'patient' | 'staff', dto.userId, dto.token, dto.platform as 'ios' | 'android' | 'web',
      { deviceName: dto.deviceName, appVersion: dto.appVersion, osVersion: dto.osVersion },
    );
  }

  /** Desregistrar token (logout o desinstalación) */
  @Delete('unregister')
  unregister(@Body() dto: UnregisterPushDto) {
    return this.pushService.unregisterToken(dto.token);
  }

  /** Enviar push de prueba */
  @Post('test')
  async testPush(@Body() dto: TestPushDto) {
    const payload = {
      title: dto.title || '🔔 Notificación de prueba',
      body: dto.body || 'Si ves esto, las push notifications funcionan.',
      category: 'test',
    };

    if (dto.userType === 'doctor') return this.pushService.sendToDoctor(dto.userId, payload);
    if (dto.userType === 'patient') return this.pushService.sendToPatient(dto.userId, payload);
    return this.pushService.sendToStaff(dto.userId, payload);
  }

  /** Stats de notificaciones */
  @Get('stats')
  stats(@Query('type') type?: string, @Query('id') id?: string) {
    return this.pushService.getStats(type, id);
  }
}
