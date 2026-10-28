import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../database/database.service';

const SEXO: Record<string, string> = { m: 'male', masculino: 'male', hombre: 'male', varon: 'male', 'varón': 'male', f: 'female', femenino: 'female', mujer: 'female' };

/** Adopción: importar pacientes, referidos entre médicos y tiempo ahorrado */
@Injectable()
export class GrowthService {
  constructor(private db: DatabaseService) {}

  // ─── Importar pacientes (desde Excel/CSV, ya parseado en el navegador) ───
  async importarPacientes(orgId: string, doctorId: string, filas: any[]) {
    if (!Array.isArray(filas) || !filas.length) throw new BadRequestException('No hay filas para importar');
    if (filas.length > 3000) throw new BadRequestException('Máximo 3000 pacientes por importación');
    const res = { creados: 0, actualizados: 0, omitidos: 0, errores: [] as { fila: number; motivo: string }[] };
    const fecha = (v: any) => {
      const s = String(v || '').trim(); if (!s) return null;
      let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
      if (m) { const y = m[3].length === 2 ? (+m[3] > 30 ? '19' : '20') + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
      m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      const n = Number(s); if (n > 1000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return d.toISOString().slice(0, 10); } // número de serie de Excel
      return null;
    };
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i] || {};
      const nombre = String(f.firstName || '').trim().slice(0, 100), apellido = String(f.lastName || '').trim().slice(0, 100);
      if (!nombre && !apellido) { res.omitidos++; continue; }
      if (!nombre || !apellido) { res.errores.push({ fila: i + 2, motivo: 'Falta nombre o apellido' }); continue; }
      const dni = String(f.dni || '').replace(/\D/g, '').slice(0, 11) || null;
      // Celular: +54 + característica + número (sin 0 ni 15), como lo guarda la reserva online
      let d = String(f.phone || '').replace(/\D/g, '');
      if (d.startsWith('54')) d = d.slice(2);
      d = d.replace(/^0/, '').replace(/^9(?=\d{10}$)/, '');
      const m15 = d.match(/^(\d{2,4})15(\d{6,8})$/);
      if (d.length === 12 && m15 && (m15[1] + m15[2]).length === 10) d = m15[1] + m15[2];
      const tel = d.length >= 8 ? '+54' + d : '';
      const email = String(f.email || '').trim().toLowerCase().slice(0, 200) || null;
      const nac = fecha(f.dateOfBirth);
      const sexo = SEXO[String(f.gender || '').trim().toLowerCase()] || null;
      try {
        const ya = dni ? await this.db.queryOne(`SELECT id FROM patients WHERE organization_id = $1 AND regexp_replace(COALESCE(dni,''),'\\D','','g') = $2`, [orgId, dni])
          : email ? await this.db.queryOne(`SELECT id FROM patients WHERE organization_id = $1 AND lower(email) = $2`, [orgId, email]) : null;
        if (ya) {
          // Solo completa lo que falta: nunca pisa datos cargados en el consultorio
          await this.db.query(
            `UPDATE patients SET phone = COALESCE(NULLIF(phone,''), $2), email = COALESCE(NULLIF(email,''), $3), date_of_birth = COALESCE(date_of_birth, $4::date),
                    insurance_provider = COALESCE(NULLIF(insurance_provider,''), $5), insurance_number = COALESCE(NULLIF(insurance_number,''), $6),
                    gender = CASE WHEN gender IS NULL OR gender::text = 'not_specified' THEN COALESCE($7::gender_type, gender) ELSE gender END,
                    address = COALESCE(NULLIF(address,''), $8), city = COALESCE(NULLIF(city,''), $9)
              WHERE id = $1`,
            [ya.id, tel || null, email, nac, f.insuranceProvider || null, f.insuranceNumber || null, sexo, f.address || null, f.city || null],
          );
          res.actualizados++;
        } else {
          await this.db.query(
            `INSERT INTO patients (organization_id, first_name, last_name, dni, phone, email, date_of_birth, gender, insurance_provider, insurance_number, address, city, notes, primary_doctor_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7::date,COALESCE($8::gender_type,'not_specified'),$9,$10,$11,$12,$13,$14)`,
            [orgId, nombre, apellido, dni, tel || null, email, nac, sexo, f.insuranceProvider || null, f.insuranceNumber || null, f.address || null, f.city || null,
             f.notes ? String(f.notes).slice(0, 2000) : null, doctorId],
          );
          res.creados++;
        }
      } catch (e: any) {
        res.errores.push({ fila: i + 2, motivo: String(e.message).slice(0, 120) });
      }
    }
    return res;
  }

  // ─── Referidos ───
  async miCodigo(doctorId: string) {
    let d = await this.db.queryOne(`SELECT referral_code FROM doctors WHERE id = $1`, [doctorId]);
    if (!d?.referral_code) {
      for (let k = 0; k < 5; k++) {
        const code = randomBytes(5).toString('base64').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7);
        if (code.length < 6) continue;
        d = await this.db.queryOne(`UPDATE doctors SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL RETURNING referral_code`, [doctorId, code]).catch(() => null);
        if (d?.referral_code) break;
        d = await this.db.queryOne(`SELECT referral_code FROM doctors WHERE id = $1`, [doctorId]);
        if (d?.referral_code) break;
      }
    }
    const r = await this.db.queryOne(
      `SELECT COUNT(*)::int AS invitados,
              COUNT(*) FILTER (WHERE license_status = 'verified')::int AS verificados
         FROM doctors WHERE referred_by_doctor_id = $1`, [doctorId]);
    return { codigo: d?.referral_code, ...r };
  }

  async reclamar(doctorId: string, code: string) {
    const c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,8}$/.test(c)) throw new BadRequestException('Código inválido');
    const ref = await this.db.queryOne(`SELECT id FROM doctors WHERE referral_code = $1`, [c]);
    if (!ref || ref.id === doctorId) throw new BadRequestException('Código inválido');
    const r = await this.db.queryOne(
      `UPDATE doctors SET referred_by_doctor_id = $2, referred_at = now()
        WHERE id = $1 AND referred_by_doctor_id IS NULL AND created_at > now() - interval '30 days' RETURNING id`,
      [doctorId, ref.id],
    );
    return { ok: !!r };
  }

  // ─── Tiempo ahorrado ───
  async metricas(doctorId: string, orgId: string) {
    const rx = await this.db.queryOne(
      `SELECT COUNT(*)::int AS recetas_mes,
              round(avg(compose_seconds) FILTER (WHERE compose_seconds IS NOT NULL))::int AS seg_promedio,
              COUNT(*) FILTER (WHERE alerts_acknowledged IS NOT NULL)::int AS con_alertas
         FROM prescriptions WHERE doctor_id = $1 AND issued_at > date_trunc('month', now())`, [doctorId]);
    const turnos = await this.db.queryOne(
      `SELECT COUNT(*) FILTER (WHERE a.created_by_type IN ('patient','public_link','public') OR br.id IS NOT NULL)::int AS online,
              COUNT(*) FILTER (WHERE a.whatsapp_reminder_sent_at IS NOT NULL)::int AS recordatorios
         FROM appointments a
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         LEFT JOIN booking_requests br ON br.appointment_id = a.id
        WHERE od.doctor_id = $1 AND a.organization_id = $2 AND a.created_at > date_trunc('month', now())`, [doctorId, orgId]);
    // Estimación conservadora frente al circuito manual: receta en papel/otra app ~3 min, turno por teléfono ~4 min, recordatorio ~1 min
    const segRx = rx?.seg_promedio || null;
    const ahorroRx = rx?.recetas_mes ? Math.max(0, 180 - (segRx || 120)) * rx.recetas_mes : 0;
    const ahorroTurnos = (turnos?.online || 0) * 240 + (turnos?.recordatorios || 0) * 30;
    return { ...rx, ...turnos, minutos_ahorrados: Math.round((ahorroRx + ahorroTurnos) / 60) };
  }
}
