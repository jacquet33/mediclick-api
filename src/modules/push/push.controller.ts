import { Controller, Post, Delete, Get, Body, Query, ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PushNotificationService } from './push.service';
import { RegisterPushDto, UnregisterPushDto, TestPushDto } from '../../common/dto/push.dto';

@Controller('api/v1/push')
export class PushController {
  constructor(private pushService: PushNotificationService) {}

  /** Registrar device token (llamado desde la app al obtener permiso de push) */
  @Post('register')
  register(@CurrentUser() u: AuthUser, @Body() dto: RegisterPushDto) {
    // El dispositivo queda a nombre de quien está logueado (antes se tomaba el userId del body)
    return this.pushService.registerToken(
      u.userType as 'doctor' | 'patient' | 'staff', u.doctorId, dto.token, dto.platform as 'ios' | 'android' | 'web',
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
  async testPush(@CurrentUser() u: AuthUser, @Body() dto: TestPushDto) {
    if (!u.isPlatformAdmin && (dto.userId !== u.doctorId || dto.userType !== u.userType)) throw new ForbiddenException('Solo podés probar en tu propio dispositivo');
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
  stats(@CurrentUser() u: AuthUser, @Query('type') type?: string, @Query('id') id?: string) {
    if (!u.isPlatformAdmin) throw new ForbiddenException();
    return this.pushService.getStats(type, id);
  }
}
