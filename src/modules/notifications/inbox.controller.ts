import { Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';
import { DatabaseService } from '../../database/database.service';

/** Campanita de la app: notificaciones del usuario logueado (turnos nuevos, solicitudes, cancelaciones…) */
@Controller('api/v1/notifications')
export class InboxController {
  constructor(private db: DatabaseService) {}

  private quien(u: AuthUser) { return { tipo: u.userType === 'patient' ? 'patient' : u.userType === 'staff' ? 'staff' : 'doctor', id: u.doctorId }; }

  @Get()
  async listar(@CurrentUser() u: AuthUser) {
    const q = this.quien(u);
    const notifications = await this.db.queryMany(
      `SELECT id, title, body, COALESCE(category, 'general') AS category, data, is_read, created_at
         FROM inbox_notifications WHERE recipient_type = $1 AND recipient_id = $2
        ORDER BY created_at DESC LIMIT 60`, [q.tipo, q.id]);
    const unread = notifications.filter((n: any) => !n.is_read).length;
    return { notifications, unread };
  }

  @Get('unread-count')
  async noLeidas(@CurrentUser() u: AuthUser) {
    const q = this.quien(u);
    const r = await this.db.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM inbox_notifications WHERE recipient_type = $1 AND recipient_id = $2 AND NOT is_read`, [q.tipo, q.id]);
    return { unread: r?.n || 0 };
  }

  @Put('mark-all-read')
  async todasLeidas(@CurrentUser() u: AuthUser) {
    const q = this.quien(u);
    await this.db.query(`UPDATE inbox_notifications SET is_read = true, read_at = now() WHERE recipient_type = $1 AND recipient_id = $2 AND NOT is_read`, [q.tipo, q.id]);
    return { ok: true };
  }

  @Put(':id/read')
  async leida(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const q = this.quien(u);
    await this.db.query(`UPDATE inbox_notifications SET is_read = true, read_at = now() WHERE id = $1 AND recipient_type = $2 AND recipient_id = $3`, [id, q.tipo, q.id]);
    return { ok: true };
  }
}
