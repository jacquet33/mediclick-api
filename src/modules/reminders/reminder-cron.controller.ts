import { Controller, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/guards/auth.guard';
import { ReminderCronService } from './reminder-cron.service';
import { ConfigService } from '@nestjs/config';
import { Logger, ForbiddenException } from '@nestjs/common';

/**
 * Endpoints internos para cron jobs.
 * Protegidos por CRON_SECRET header o IP local.
 *
 * Cron setup en VPS:
 *   # Recordatorios del día siguiente (20:00 cada día)
 *   0 20 * * * curl -s -X POST -H "X-Cron-Secret: <secret>" http://localhost:3000/api/v1/internal/reminders/tomorrow
 *
 *   # Recordatorios inmediatos 1h antes (cada 15 min)
 *   *\/15 * * * * curl -s -X POST -H "X-Cron-Secret: <secret>" http://localhost:3000/api/v1/internal/reminders/upcoming
 */
@Public()
@Controller('api/v1/internal/reminders')
export class ReminderCronController {
  private readonly logger = new Logger(ReminderCronController.name);

  constructor(
    private cronService: ReminderCronService,
    private config: ConfigService,
  ) {}

  private validateCronAccess(req: Request) {
    const secret = this.config.get('CRON_SECRET');
    const headerSecret = req.headers['x-cron-secret'];
    const ip = req.ip || req.socket?.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

    // Si hay CRON_SECRET configurado, validar header o localhost
    if (secret) {
      if (headerSecret !== secret && !isLocal) {
        throw new ForbiddenException('Acceso no autorizado al endpoint interno');
      }
    } else {
      // Sin CRON_SECRET, solo permitir localhost (Docker internal)
      if (!isLocal) {
        this.logger.warn(`Cron access attempt from external IP ${ip} without CRON_SECRET configured`);
        throw new ForbiddenException('Endpoint interno no disponible');
      }
    }
  }

  @Post('tomorrow')
  async sendTomorrowReminders(@Req() req: Request) {
    this.validateCronAccess(req);
    this.logger.log('Cron: sending tomorrow reminders...');
    return this.cronService.sendTomorrowReminders();
  }

  @Post('upcoming')
  async sendUpcomingReminders(
    @Req() req: Request,
    @Query('minutes') minutes?: string,
  ) {
    this.validateCronAccess(req);
    const mins = minutes ? parseInt(minutes) : 60;
    this.logger.log(`Cron: sending upcoming reminders (${mins}min window)...`);
    return this.cronService.sendUpcomingReminders(mins);
  }
}
