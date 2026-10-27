import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/** Resumen del consultorio. Recibe los org_doctor_id visibles (un médico o todo el consultorio). */
@Injectable()
export class DashboardService {
  constructor(private db: DatabaseService) {}

  async getStats(orgId: string, ids: string[]) {
    // Fecha local de Argentina (el servidor corre en UTC)
    const today = new Date(Date.now() - 3 * 3600_000).toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';
    const p = [orgId, ids];
    const scope = 'a.organization_id = $1 AND a.org_doctor_id = ANY($2::uuid[])';

    const [todayCounts, monthCounts, totalPatients, upcoming, schedule, recentActivity, last14] = await Promise.all([
      this.db.queryMany(`SELECT a.status::text AS status, COUNT(*)::int AS n FROM appointments a WHERE ${scope} AND a.date = $3::date GROUP BY 1`, [...p, today]),
      this.db.queryMany(`SELECT a.status::text AS status, COUNT(*)::int AS n FROM appointments a WHERE ${scope} AND a.date >= $3::date AND a.date <= $4::date GROUP BY 1`, [...p, monthStart, today]),
      this.db.queryOne(`SELECT COUNT(*)::int AS n FROM patients WHERE organization_id = $1 AND COALESCE(is_active, true)`, [orgId]),
      this.db.queryMany(`SELECT a.status::text AS status, COUNT(*)::int AS n FROM appointments a WHERE ${scope} AND a.date >= $3::date GROUP BY 1`, [...p, today]),
      this.db.queryMany(
        `SELECT a.id, to_char(a.date, 'YYYY-MM-DD') AS date, a.start_time, a.end_time, a.status, a.reason, a.notes,
                p.id AS patient_id, p.first_name || ' ' || p.last_name AS patient_name, p.phone AS patient_phone,
                d.first_name || ' ' || d.last_name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         JOIN doctors d ON d.id = od.doctor_id
         WHERE ${scope} AND a.date = $3::date AND a.status <> 'cancelled'
         ORDER BY a.start_time`,
        [...p, today],
      ),
      this.db.queryMany(
        `SELECT a.id, to_char(a.date, 'YYYY-MM-DD') AS date, a.start_time, a.status, a.updated_at, a.created_by_type,
                p.first_name || ' ' || p.last_name AS patient_name
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE ${scope}
         ORDER BY a.updated_at DESC NULLS LAST
         LIMIT 8`,
        p,
      ),
      this.db.queryMany(
        `SELECT to_char(g.d, 'YYYY-MM-DD') AS date,
                COUNT(a.id) FILTER (WHERE a.status = 'completed')::int AS completed,
                COUNT(a.id) FILTER (WHERE a.status NOT IN ('cancelled'))::int AS total
         FROM generate_series($3::date - 13, $3::date, '1 day') g(d)
         LEFT JOIN appointments a ON a.date = g.d AND ${scope}
         GROUP BY g.d ORDER BY g.d`,
        [...p, today],
      ),
    ]);

    const map = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
    const sum = (m: Record<string, number>, keys?: string[]) =>
      Object.entries(m).filter(([k]) => !keys || keys.includes(k)).reduce((a, [, v]) => a + v, 0);
    const t = map(todayCounts), m = map(monthCounts), u = map(upcoming);
    const PEND = ['pending', 'pending_approval', 'pending_payment'];

    return {
      today: {
        date: today,
        total: sum(t) - (t.cancelled || 0),
        pending: sum(t, PEND),
        confirmed: t.confirmed || 0,
        checkedIn: t.checked_in || 0,
        inProgress: t.in_progress || 0,
        completed: t.completed || 0,
        cancelled: t.cancelled || 0,
        noShow: t.no_show || 0,
        schedule,
      },
      month: {
        period: monthStart,
        total: sum(m) - (m.cancelled || 0),
        completed: m.completed || 0,
        cancelled: m.cancelled || 0,
        noShow: m.no_show || 0,
        byStatus: m,
      },
      patients: { total: totalPatients?.n || 0 },
      pending: sum(u, PEND),
      upcomingConfirmed: u.confirmed || 0,
      recentActivity,
      last14,
    };
  }
}
