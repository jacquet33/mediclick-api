import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { EmailService } from '../email/email.service';

type Ev = { kind: string; userType?: string; userId?: string; email?: string; detail?: string; ip?: string; ua?: string };

/**
 * Actividad de acceso y seguimiento de altas de médicos.
 * - Registra logins (ok/fallidos), altas y entradas con Google (sin contraseñas ni tokens).
 * - Recuerda por email a los médicos que empezaron el alta y no cargaron DNI/matrícula:
 *   a las 3 h, a los 2 días y a los 6 días; después no se insiste más. Se puede desuscribir.
 */
@Injectable()
export class ActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActivityService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private db: DatabaseService, private email: EmailService, private config: ConfigService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.recordarAltas().catch((e) => this.logger.warn(e.message)), 30 * 60_000);
    setTimeout(() => this.recordarAltas().catch((e) => this.logger.warn(e.message)), 2 * 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  registrar(e: Ev) {
    this.db.query(
      `INSERT INTO auth_events (kind, user_type, user_id, email, detail, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.kind, e.userType || null, e.userId || null, e.email ? String(e.email).toLowerCase().slice(0, 255) : null,
       e.detail ? String(e.detail).slice(0, 200) : null, e.ip ? String(e.ip).slice(0, 64) : null, e.ua ? String(e.ua).slice(0, 300) : null],
    ).catch(() => undefined);
  }

  private async admin(userId: string) {
    const a = await this.db.queryOne(`SELECT is_platform_admin FROM doctors WHERE id = $1`, [userId]);
    if (!a?.is_platform_admin) throw new ForbiddenException('Solo administradores de la plataforma');
  }

  /** Panel del administrador: altas, médicos con alta incompleta y accesos recientes */
  async panel(adminId: string) {
    await this.admin(adminId);
    const [resumen, medicos, eventos, porDia, pacientes] = await Promise.all([
      this.db.queryOne(
        `SELECT (SELECT count(*) FROM doctors)::int AS medicos,
                (SELECT count(*) FROM doctors WHERE created_at > now() - interval '7 days')::int AS medicos_7d,
                (SELECT count(*) FROM doctors WHERE license_status = 'verified')::int AS verificados,
                (SELECT count(*) FROM doctors WHERE license_status = 'pending')::int AS en_revision,
                (SELECT count(*) FROM doctors WHERE COALESCE(license_status,'unverified') IN ('unverified','rejected'))::int AS incompletos,
                (SELECT count(*) FROM patient_auth)::int AS pacientes_con_cuenta,
                (SELECT count(*) FROM patient_auth WHERE created_at > now() - interval '7 days')::int AS pacientes_7d,
                (SELECT count(DISTINCT COALESCE(user_id::text, email)) FROM auth_events WHERE kind IN ('login_ok','google_ok') AND created_at > now() - interval '24 hours')::int AS activos_24h,
                (SELECT count(*) FROM auth_events WHERE kind IN ('login_fail','google_fail') AND created_at > now() - interval '24 hours')::int AS fallidos_24h,
                (SELECT count(*) FROM doctor_onboarding_emails WHERE ok)::int AS recordatorios_enviados`),
      this.db.queryMany(
        `SELECT d.id, d.first_name, d.last_name, d.email, d.phone, d.specialty, d.created_at, d.last_login_at,
                COALESCE(d.license_status,'unverified') AS estado, d.license_verification_note AS nota,
                (d.dni IS NOT NULL AND d.dni <> '') AS tiene_dni, (d.dni_document IS NOT NULL) AS tiene_foto_dni,
                (d.medical_license IS NOT NULL AND d.medical_license <> '') AS tiene_matricula, (d.license_document IS NOT NULL) AS tiene_credencial,
                d.onboarding_emails_opt_out AS desuscripto,
                (SELECT max(step) FROM doctor_onboarding_emails e WHERE e.doctor_id = d.id AND e.ok) AS recordatorios,
                (SELECT count(*) FROM appointments a JOIN organization_doctors od ON od.id = a.org_doctor_id WHERE od.doctor_id = d.id)::int AS turnos,
                (SELECT count(*) FROM prescriptions rx WHERE rx.doctor_id = d.id)::int AS recetas
           FROM doctors d ORDER BY d.created_at DESC LIMIT 300`),
      this.db.queryMany(
        `SELECT kind, user_type, email, detail, ip, created_at FROM auth_events ORDER BY created_at DESC LIMIT 200`),
      this.db.queryMany(
        `SELECT to_char(d,'YYYY-MM-DD') AS dia,
                (SELECT count(*) FROM doctors WHERE created_at::date = d)::int AS medicos,
                (SELECT count(*) FROM patient_auth WHERE created_at::date = d)::int AS pacientes,
                (SELECT count(*) FROM auth_events WHERE created_at::date = d AND kind IN ('login_ok','google_ok'))::int AS logins,
                (SELECT count(*) FROM auth_events WHERE created_at::date = d AND kind IN ('login_fail','google_fail'))::int AS fallidos
           FROM generate_series((now() - interval '13 days')::date, now()::date, interval '1 day') d ORDER BY d`),
      this.db.queryMany(
        `SELECT pa.email, pa.created_at, pa.last_login_at, p.first_name, p.last_name
           FROM patient_auth pa LEFT JOIN patients p ON p.id = pa.patient_id ORDER BY pa.created_at DESC LIMIT 50`),
    ]);
    return { resumen, medicos, eventos, porDia, pacientes };
  }

  // ─── Recordatorio de alta incompleta ───

  private firma(doctorId: string) {
    const k = this.config.get<string>('JWT_SECRET') || 'tco';
    return createHmac('sha256', k).update('baja:' + doctorId).digest('hex').slice(0, 32);
  }

  async desuscribir(doctorId: string, t: string) {
    if (!doctorId || t !== this.firma(doctorId)) return false;
    await this.db.query(`UPDATE doctors SET onboarding_emails_opt_out = true WHERE id = $1`, [doctorId]);
    return true;
  }

  private faltantes(d: any) {
    const f: string[] = [];
    if (!d.dni) f.push('Tu número de DNI');
    if (!d.dni_document) f.push('Una foto clara del frente de tu DNI');
    if (!d.medical_license) f.push('Tu número de matrícula (nacional o provincial)');
    if (d.license_status === 'rejected') f.push('Corregir los datos de la matrícula' + (d.license_verification_note ? `: ${d.license_verification_note}` : ''));
    if (!f.length) f.push('Confirmar tus datos profesionales para validarlos en REFEPS');
    return f;
  }

  async recordarAltas() {
    if (this.running) return;
    this.running = true;
    try {
      const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }).format(new Date()));
      if (h < 9 || h >= 20) return; // solo en horario razonable
      if (!this.email.configurado) return; // sin SMTP no se marca nada como enviado
      const desde = (await this.db.queryOne(`SELECT value FROM platform_settings WHERE key = 'onboarding_emails_since'`))?.value;
      if (!desde) return;
      // Pasos: 1 a las 3 h, 2 a los 2 días, 3 a los 6 días del alta
      const pendientes = await this.db.queryMany(
        `SELECT d.*, s.step FROM doctors d
           CROSS JOIN LATERAL (
             SELECT CASE
               WHEN NOT EXISTS (SELECT 1 FROM doctor_onboarding_emails e WHERE e.doctor_id = d.id AND e.step = 1) AND d.created_at < now() - interval '3 hours' THEN 1
               WHEN NOT EXISTS (SELECT 1 FROM doctor_onboarding_emails e WHERE e.doctor_id = d.id AND e.step = 2) AND d.created_at < now() - interval '2 days' THEN 2
               WHEN NOT EXISTS (SELECT 1 FROM doctor_onboarding_emails e WHERE e.doctor_id = d.id AND e.step = 3) AND d.created_at < now() - interval '6 days' THEN 3
             END AS step) s
          WHERE s.step IS NOT NULL
            AND d.created_at >= $1::timestamptz AND d.created_at > now() - interval '30 days'
            AND COALESCE(d.license_status,'unverified') IN ('unverified','rejected')
            AND NOT d.onboarding_emails_opt_out
            AND d.email ~ '@' AND d.email !~* '@(test|example)\\.'
          LIMIT 25`,
        [desde],
      );
      for (const d of pendientes) {
        // Se marca antes de enviar para no repetir si algo falla a mitad de camino
        const r = await this.db.queryOne(
          `INSERT INTO doctor_onboarding_emails (doctor_id, step) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`, [d.id, d.step]);
        if (!r) continue;
        // Si se saltó un paso (por ejemplo, el servidor estuvo apagado), los anteriores quedan registrados como no enviados
        for (let k = 1; k < d.step; k++) await this.db.query(`INSERT INTO doctor_onboarding_emails (doctor_id, step, ok) VALUES ($1,$2,false) ON CONFLICT DO NOTHING`, [d.id, k]);
        const ok = await this.enviarRecordatorio(d, d.step).catch(() => false);
        if (!ok) await this.db.query(`UPDATE doctor_onboarding_emails SET ok = false WHERE id = $1`, [r.id]);
      }
    } finally {
      this.running = false;
    }
  }

  private async enviarRecordatorio(d: any, step: number) {
    const base = this.config.get<string>('BASE_URL') || 'https://tuconsultorio.rispy.io';
    const nombre = [d.title_prefix || 'Dr./a', d.last_name || d.first_name].filter(Boolean).join(' ');
    const asunto = step === 1 ? '¡Estás a un paso de usar TuConsultorioOnline!' : step === 2 ? 'Te falta muy poco para emitir recetas' : 'Tu consultorio te espera — completá tu alta';
    const lista = this.faltantes(d).map((x) => `<li style="margin:6px 0">${esc(x)}</li>`).join('');
    const baja = `${base}/api/v1/public/onboarding/baja?d=${d.id}&t=${this.firma(d.id)}`;
    const html = `<!doctype html><html><body style="margin:0;background:#F5F1EA;font-family:Helvetica,Arial,sans-serif;color:#2B241F">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EA;padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#9A6B3F,#3E7468);background-color:#6F4A2A;padding:28px 24px;text-align:center;color:#fff">
<div style="font-size:24px;font-weight:800">TuConsultorio<span style="font-weight:500">Online</span></div><div style="font-size:12px;opacity:.85">by Rispy</div></td></tr>
<tr><td style="padding:26px 28px">
<h1 style="font-size:21px;margin:0 0 6px;color:#3E7468">¡Estás a un paso de usar TuConsultorioOnline!</h1>
<p style="font-size:15px;margin:0 0 14px">Hola, ${esc(nombre)}:</p>
<p style="font-size:15px;line-height:1.55;margin:0 0 12px">Para validar tu perfil profesional en <b>REFEPS</b> (Ministerio de Salud) y habilitarte a <b>emitir recetas electrónicas</b>, nos falta:</p>
<ul style="font-size:15px;line-height:1.45;padding-left:20px;margin:0 0 14px">${lista}</ul>
<p style="font-size:13px;line-height:1.5;background:#FFF6E5;border:1px solid #F1DFC0;border-radius:10px;padding:10px 12px;margin:0 0 18px"><b>Importante:</b> subí una foto <b>clara y legible</b> del frente de tu DNI y de tu credencial de matrícula. No envíes selfies ni fotos borrosas. Solo la usa el equipo de verificación.</p>
<p style="text-align:center;margin:0 0 18px"><a href="${base}/portal#matricula" style="display:inline-block;background:#9A6B3F;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:12px">Completar mi alta</a></p>
<p style="font-size:13px;color:#7A6E62;line-height:1.5;margin:0">Mientras tanto ya podés configurar tu agenda y recibir turnos online. ¿Dudas? Respondé este correo o escribinos a contact@rispy.io.</p>
</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid #F0E8DC;font-size:11px;color:#9A8B7A;text-align:center">Recibís este correo porque iniciaste el alta en TuConsultorioOnline con este email.<br><a href="${baja}" style="color:#9A8B7A">No quiero recibir más estos avisos</a></td></tr>
</table></td></tr></table></body></html>`;
    const ok = await this.email.send({ to: d.email, subject: asunto, html } as any);
    this.logger.log(`Recordatorio de alta ${step} a médico ${d.id}: ${ok ? 'enviado' : 'no enviado'}`);
    return ok;
  }
}

function esc(s: any) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)); }
