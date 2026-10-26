import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class DashboardService {
  constructor(private db: DatabaseService) {}

  async getStats(orgId: string, doctorId: string) {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';

    // Todas las queries en paralelo para velocidad
    const [
      todayAppts,
      monthAppts,
      totalPatients,
      pendingAppts,
      todaySchedule,
      monthRevenue,
      recentActivity,
    ] = await Promise.all([
      // Turnos hoy
      this.db.queryOne(
        `SELECT COUNT(*) AS count,
                COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE status = 'no_show') AS no_show
         FROM appointments a
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         WHERE od.organization_id = $1 AND od.doctor_id = $2
           AND a.date = $3::date AND a.deleted_at IS NULL`,
        [orgId, doctorId, today],
      ),

      // Turnos este mes
      this.db.queryOne(
        `SELECT COUNT(*) AS count,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE status = 'no_show') AS no_show
         FROM appointments a
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         WHERE od.organization_id = $1 AND od.doctor_id = $2
           AND a.date >= $3::date AND a.deleted_at IS NULL`,
        [orgId, doctorId, monthStart],
      ),

      // Total pacientes
      this.db.queryOne(
        `SELECT COUNT(*) AS count FROM patients WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId],
      ),

      // Turnos pendientes (próximos)
      this.db.queryOne(
        `SELECT COUNT(*) AS count
         FROM appointments a
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         WHERE od.organization_id = $1 AND od.doctor_id = $2
           AND a.date >= $3::date AND a.status IN ('confirmed', 'scheduled')
           AND a.deleted_at IS NULL`,
        [orgId, doctorId, today],
      ),

      // Agenda de hoy (próximos turnos)
      this.db.queryMany(
        `SELECT a.id, a.start_time, a.end_time, a.status, a.notes,
                p.first_name || ' ' || p.last_name AS patient_name,
                p.phone AS patient_phone
         FROM appointments a
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         JOIN patients p ON p.id = a.patient_id
         WHERE od.organization_id = $1 AND od.doctor_id = $2
           AND a.date = $3::date AND a.deleted_at IS NULL
           AND a.status IN ('confirmed', 'scheduled')
         ORDER BY a.start_time
         LIMIT 10`,
        [orgId, doctorId, today],
      ),

      // Facturación del mes (si hay billing)
      this.db.queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS total,
                COUNT(*) AS invoices
         FROM billing_records br
         WHERE br.organization_id = $1 AND br.doctor_id = $2
           AND br.date >= $3::date`,
        [orgId, doctorId, monthStart],
      ).catch(() => ({ total: 0, invoices: 0 })),

      // Actividad reciente
      this.db.queryMany(
        `SELECT a.id, a.date, a.start_time, a.status, a.updated_at,
                p.first_name || ' ' || p.last_name AS patient_name
         FROM appointments a
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         JOIN patients p ON p.id = a.patient_id
         WHERE od.organization_id = $1 AND od.doctor_id = $2
           AND a.deleted_at IS NULL
         ORDER BY a.updated_at DESC
         LIMIT 5`,
        [orgId, doctorId],
      ),
    ]);

    return {
      today: {
        date: today,
        total: parseInt(todayAppts.count),
        confirmed: parseInt(todayAppts.confirmed),
        completed: parseInt(todayAppts.completed),
        cancelled: parseInt(todayAppts.cancelled),
        noShow: parseInt(todayAppts.no_show),
        schedule: todaySchedule,
      },
      month: {
        period: monthStart,
        total: parseInt(monthAppts.count),
        completed: parseInt(monthAppts.completed),
        cancelled: parseInt(monthAppts.cancelled),
        noShow: parseInt(monthAppts.no_show),
        revenue: parseFloat(monthRevenue?.total || '0'),
        invoices: parseInt(monthRevenue?.invoices || '0'),
      },
      patients: {
        total: parseInt(totalPatients.count),
      },
      pending: parseInt(pendingAppts.count),
      recentActivity,
    };
  }
}
