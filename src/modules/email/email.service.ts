import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Servicio de emails transaccionales.
 *
 * Usa nodemailer con SMTP. Configurable vía:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Si no está configurado, loguea los emails en consola (modo dev).
 */

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface EmailWithAttachmentOptions extends EmailOptions {
  attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: any = null;

  constructor(private config: ConfigService) {
    this.initTransporter();
  }

  private async initTransporter() {
    const host = this.config.get('SMTP_HOST');
    if (!host) {
      this.logger.warn('SMTP not configured — emails will be logged to console');
      return;
    }

    try {
      // Importar nodemailer dinámicamente (puede no estar instalado en dev)
      const nodemailer = await import('nodemailer');
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(this.config.get('SMTP_PORT') || '587'),
        secure: this.config.get('SMTP_PORT') === '465',
        auth: {
          user: this.config.get('SMTP_USER'),
          pass: this.config.get('SMTP_PASS'),
        },
      });
      this.logger.log(`SMTP configured: ${host}`);
    } catch (err) {
      this.logger.warn('nodemailer not available — emails will be logged');
    }
  }

  // ─── ENVIAR ──────────────────────────────────────────────

  async send(options: EmailOptions): Promise<boolean> {
    const from = this.config.get('SMTP_FROM') || 'MediClick <no-reply@mediclick.app>';

    if (!this.transporter) {
      this.logger.log(`[EMAIL] To: ${options.to} | Subject: ${options.subject}`);
      this.logger.debug(`[EMAIL] Body preview: ${options.html.substring(0, 200)}...`);
      return true; // En dev, simula éxito
    }

    try {
      await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
      return true;
    } catch (err) {
      this.logger.error(`Email failed to ${options.to}`, err);
      return false;
    }
  }

  // ─── ENVIAR CON ADJUNTOS ─────────────────────────────────

  async sendWithAttachment(options: EmailWithAttachmentOptions): Promise<boolean> {
    const from = this.config.get('SMTP_FROM') || 'MediClick <no-reply@mediclick.app>';

    if (!this.transporter) {
      this.logger.log(`[EMAIL+ATTACHMENT] To: ${options.to} | Subject: ${options.subject} | Files: ${options.attachments.map(a => a.filename).join(', ')}`);
      return true; // En dev, simula éxito
    }

    try {
      await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments.map(a => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      this.logger.log(`Email+attachment sent to ${options.to}: ${options.subject}`);
      return true;
    } catch (err) {
      this.logger.error(`Email+attachment failed to ${options.to}`, err);
      return false;
    }
  }

  // ─── TEMPLATES ───────────────────────────────────────────

  /** Email de bienvenida al doctor */
  async sendWelcome(email: string, name: string): Promise<boolean> {
    return this.send({
      to: email,
      subject: '¡Bienvenido a MediClick!',
      html: this.wrapTemplate(`
        <h2 style="color:#161925;margin-bottom:16px;">¡Hola Dr/a. ${name}!</h2>
        <p>Tu cuenta de MediClick fue creada exitosamente.</p>
        <p>Ya tenés todo listo para empezar:</p>
        <ul style="padding-left:20px;">
          <li>📅 Tu agenda Lunes a Viernes de 9 a 18hs ya está configurada</li>
          <li>🔗 Tu página de turnos online ya está activa</li>
          <li>📱 Descargá la app para gestionar desde tu celular</li>
        </ul>
        <p style="margin-top:24px;">
          <a href="https://mediclick.art3d-studio.com.ar/para-medicos"
             style="background:#879DFF;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;">
            Ver mi panel
          </a>
        </p>
        <p style="color:#666;font-size:13px;margin-top:24px;">
          ¿Necesitás ayuda? Respondé a este email y te asistimos.
        </p>
      `),
    });
  }

  /** Confirmación de turno al paciente */
  async sendAppointmentConfirmation(
    patientEmail: string,
    patientName: string,
    doctorName: string,
    date: string,
    time: string,
    address?: string,
  ): Promise<boolean> {
    return this.send({
      to: patientEmail,
      subject: `Turno confirmado — Dr/a. ${doctorName}`,
      html: this.wrapTemplate(`
        <h2 style="color:#161925;margin-bottom:16px;">Turno confirmado</h2>
        <p>Hola ${patientName},</p>
        <p>Tu turno fue confirmado:</p>
        <div style="background:#FFF7F3;border-radius:12px;padding:20px;margin:16px 0;">
          <p style="margin:4px 0;"><strong>Doctor/a:</strong> ${doctorName}</p>
          <p style="margin:4px 0;"><strong>Fecha:</strong> ${date}</p>
          <p style="margin:4px 0;"><strong>Hora:</strong> ${time}</p>
          ${address ? `<p style="margin:4px 0;"><strong>Dirección:</strong> ${address}</p>` : ''}
        </div>
        <p style="color:#666;font-size:13px;">
          Si necesitás cancelar o reprogramar, contactá al consultorio.
        </p>
      `),
    });
  }

  /** Recordatorio de turno al paciente */
  async sendAppointmentReminder(
    patientEmail: string,
    patientName: string,
    doctorName: string,
    date: string,
    time: string,
  ): Promise<boolean> {
    return this.send({
      to: patientEmail,
      subject: `Recordatorio: turno mañana con Dr/a. ${doctorName}`,
      html: this.wrapTemplate(`
        <h2 style="color:#161925;margin-bottom:16px;">Recordatorio de turno</h2>
        <p>Hola ${patientName},</p>
        <p>Te recordamos que tenés turno mañana:</p>
        <div style="background:#FFF7F3;border-radius:12px;padding:20px;margin:16px 0;">
          <p style="margin:4px 0;"><strong>Doctor/a:</strong> ${doctorName}</p>
          <p style="margin:4px 0;"><strong>Fecha:</strong> ${date}</p>
          <p style="margin:4px 0;"><strong>Hora:</strong> ${time}</p>
        </div>
      `),
    });
  }

  /** Notificación de pago exitoso */
  async sendPaymentConfirmation(
    email: string,
    name: string,
    plan: string,
    amount: string,
  ): Promise<boolean> {
    return this.send({
      to: email,
      subject: `Pago confirmado — MediClick ${plan}`,
      html: this.wrapTemplate(`
        <h2 style="color:#161925;margin-bottom:16px;">¡Pago confirmado!</h2>
        <p>Hola Dr/a. ${name},</p>
        <p>Tu pago fue procesado exitosamente:</p>
        <div style="background:#FFF7F3;border-radius:12px;padding:20px;margin:16px 0;">
          <p style="margin:4px 0;"><strong>Plan:</strong> MediClick ${plan}</p>
          <p style="margin:4px 0;"><strong>Monto:</strong> ${amount}</p>
          <p style="margin:4px 0;"><strong>Estado:</strong> ✅ Aprobado</p>
        </div>
        <p style="color:#666;font-size:13px;">
          Podés ver tus facturas en la sección Suscripción de tu panel.
        </p>
      `),
    });
  }

  // ─── TEMPLATE WRAPPER ────────────────────────────────────

  wrapTemplate(content: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;margin-top:20px;">
    <!-- Header -->
    <tr>
      <td style="background:#161925;padding:24px 32px;">
        <h1 style="color:#879DFF;margin:0;font-size:24px;font-weight:700;">MediClick</h1>
      </td>
    </tr>
    <!-- Content -->
    <tr>
      <td style="padding:32px;">
        ${content}
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="background:#FFF7F3;padding:16px 32px;text-align:center;">
        <p style="margin:0;color:#999;font-size:12px;">
          © ${new Date().getFullYear()} MediClick ·
          <a href="https://mediclick.art3d-studio.com.ar/privacidad" style="color:#879DFF;">Privacidad</a> ·
          <a href="https://mediclick.art3d-studio.com.ar/terminos" style="color:#879DFF;">Términos</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
