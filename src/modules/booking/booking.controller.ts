const PDFDocument = require('pdfkit');
import { join } from 'path';
const QRCode = require('qrcode');
import { Response } from 'express';
import { ScheduleService } from '../schedules/schedule.service';
import { UseGuards, Res } from '@nestjs/common';
import { CaptchaGuard } from '../../common/guards/captcha.guard';
import { Controller, Get, Post, Put, Patch, Body, Param, Query } from '@nestjs/common';
import { BookingService } from './booking.service';
import { WhatsappReminderService } from '../reminders/whatsapp-reminder.service';
import { CreateBookingDto, BookingSettingsDto } from '../../common/dto/booking.dto';
import { PublicRegisterPatientDto } from '../../common/dto/public-patient.dto';
import { UploadPaymentProofDto, CancelBookingDto, WhatsappReminderDto } from '../../common/dto/misc.dto';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/guards/auth.guard';
import { PublicThrottle, StrictThrottle } from '../../common/decorators/throttle.decorator';

// ═══════════════════════════════════════════════════════════
// PÚBLICO — sin autenticación (para pacientes)
// ═══════════════════════════════════════════════════════════

@Public()
@PublicThrottle()
@Controller('api/v1/public/booking')
export class PublicBookingController {
  constructor(private bookingService: BookingService, private waReminder: WhatsappReminderService, private schedules: ScheduleService) {}

  /** POST /public/booking/status/:token/whatsapp-reminder — el paciente pide recordatorio 1 día antes */
  @Post('status/:token/whatsapp-reminder')
  whatsappReminder(@Param('token') token: string, @Body() body: WhatsappReminderDto) {
    return this.waReminder.solicitar(token, String(body?.phone || ''));
  }

  /** GET /public/booking/doctor/:doctorSlug — todos los consultorios del doctor */
  @Get('doctor/:doctorSlug')
  getDoctorLocations(@Param('doctorSlug') doctorSlug: string) {
    return this.bookingService.getPublicDoctorLocations(doctorSlug);
  }

  /** GET /public/booking/:slug — perfil del médico (por org_doctor slug) */
  @Get(':slug')
  getProfile(@Param('slug') slug: string) {
    return this.bookingService.getPublicProfile(slug);
  }

  /** GET /public/booking/:slug/qr — QR (PNG) del link de turnos del médico, para imprimir en el consultorio */
  @Get(':slug/qr')
  async getQr(@Param('slug') slug: string, @Res() res: Response) {
    const p: any = await this.bookingService.getPublicProfile(slug);
    const base = (process.env.BASE_URL || 'https://tusrecetasmed.com').replace(/\/$/, '');
    const png: Buffer = await QRCode.toBuffer(`${base}/${p.public_slug}`, { width: 720, margin: 2, color: { dark: '#231C17', light: '#FFFFFF' } });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Disposition': `inline; filename="turnos-${p.public_slug}.png"` });
    res.end(png);
  }

  /** GET /public/booking/:slug/cartel.pdf — cartel A4 con el QR para imprimir y pegar en el consultorio */
  @Get(':slug/cartel.pdf')
  async getCartel(@Param('slug') slug: string, @Res() res: Response) {
    const p: any = await this.bookingService.getPublicProfile(slug);
    const base = (process.env.BASE_URL || 'https://tusrecetasmed.com').replace(/\/$/, '');
    const link = `${base}/${p.public_slug}`;
    const qr: Buffer = await QRCode.toBuffer(link, { width: 900, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#231C17', light: '#FFFFFF' } });
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Turnos online — Dr/a. ${p.doctor_name}`, Author: 'TusRecetasMed' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const fin = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(chunks))));
    const W = 595.28, H = 841.89, cx = W / 2;
    const tinta = '#231C17', cara = '#9A6B3F', salvia = '#5E6E44', suave = '#6B5F55';

    // Fondo crema y franja superior
    doc.rect(0, 0, W, H).fill('#FBF7EF');
    doc.rect(0, 0, W, 150).fill('#2B241F');
    try { doc.image(join(__dirname, '..', '..', '..', 'public', 'img', 'logo-256.png'), cx - 26, 30, { width: 52 }); } catch { /* sin logo */ }
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#FFFFFF');
    const marca1 = 'TusRecetas', marca2 = 'Med';
    const wMarca = doc.widthOfString(marca1) + doc.widthOfString(marca2);
    doc.text(marca1, cx - wMarca / 2, 94, { continued: true }).fillColor('#B9C79B').text(marca2);

    // Titular
    doc.font('Helvetica-Bold').fontSize(34).fillColor(tinta).text('Sacá tu turno online', 0, 190, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(15).fillColor(suave).text('Sin llamar, las 24 horas, desde tu celular', 0, 234, { width: W, align: 'center' });

    // Médico
    const prof = `Dr/a. ${p.doctor_name}`;
    doc.font('Helvetica-Bold').fontSize(20).fillColor(cara).text(prof, 40, 280, { width: W - 80, align: 'center' });
    const sub = [p.specialty, p.medical_license ? `MP ${p.medical_license}` : null, p.org_name && p.org_name !== `Dr. ${p.doctor_name}` ? p.org_name : null].filter(Boolean).join('  ·  ');
    if (sub) doc.font('Helvetica').fontSize(12).fillColor(suave).text(sub, 40, 308, { width: W - 80, align: 'center' });

    // QR en tarjeta blanca
    const q = 300, qx = cx - q / 2, qy = 345;
    doc.roundedRect(qx - 22, qy - 22, q + 44, q + 44, 26).lineWidth(1.2).fillAndStroke('#FFFFFF', '#E7DED1');
    doc.image(qr, qx, qy, { width: q });

    // Link
    const corto = link.replace(/^https?:\/\//, '');
    doc.font('Helvetica-Bold').fontSize(19).fillColor(tinta).text(corto, 0, qy + q + 40, { width: W, align: 'center' });

    // Pasos
    const pasos = ['Abrí la cámara y apuntá al código', 'Elegí el día y el horario', 'Listo: te llega el recordatorio por WhatsApp'];
    const py = qy + q + 86, colW = (W - 80) / 3;
    pasos.forEach((t, i) => {
      const x = 40 + i * colW;
      doc.circle(x + colW / 2, py + 14, 14).fill(salvia);
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF').text(String(i + 1), x, py + 7, { width: colW, align: 'center' });
      doc.font('Helvetica').fontSize(11).fillColor(tinta).text(t, x + 10, py + 36, { width: colW - 20, align: 'center' });
    });

    doc.font('Helvetica').fontSize(9).fillColor('#9A8B7A').text('tusrecetasmed.com · Turnos, recetas e historia clínica', 0, H - 34, { width: W, align: 'center' });
    doc.end();
    const pdf = await fin;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="cartel-turnos-${p.public_slug}.pdf"`, 'Cache-Control': 'no-store' });
    res.end(pdf);
  }

  /** GET /public/booking/:slug/days — días de la semana con atención y fechas bloqueadas (el resto va en gris) */
  @Get(':slug/days')
  async getDays(@Param('slug') slug: string) {
    const p: any = await this.bookingService.getPublicProfile(slug);
    const hoy = new Date();
    const hasta = new Date(hoy.getTime() + (Number(p.max_days_in_advance) || 60) * 86400000);
    return this.schedules.diasConAtencion(p.org_doctor_id, hoy.toISOString().slice(0, 10), hasta.toISOString().slice(0, 10));
  }

  /** GET /public/booking/:slug/slots?date=2026-09-01 */
  @Get(':slug/slots')
  getSlots(@Param('slug') slug: string, @Query('date') date: string) {
    return this.bookingService.getPublicSlots(slug, date);
  }

  /** POST /public/booking/:slug — crear reserva */
  @Post(':slug')
  @StrictThrottle()
  @UseGuards(CaptchaGuard)
  createBooking(@Param('slug') slug: string, @Body() dto: CreateBookingDto) {
    return this.bookingService.createBooking(slug, dto);
  }

  /** GET /public/booking/status/:token — consultar reserva */
  @Get('status/:token')
  getStatus(@Param('token') token: string) {
    return this.bookingService.getBookingByToken(token);
  }

  /** POST /public/booking/status/:token/payment — subir comprobante */
  @Post('status/:token/payment')
  uploadProof(
    @Param('token') token: string,
    @Body() dto: UploadPaymentProofDto,
  ) {
    return this.bookingService.uploadPaymentProof(token, dto.proofUrl, dto.reference);
  }

  /** POST /public/booking/status/:token/cancel */
  @Post('status/:token/cancel')
  cancel(@Param('token') token: string, @Body() dto: CancelBookingDto) {
    return this.bookingService.cancelBooking(token, dto?.reason);
  }

  /** POST /public/booking/:slug/register-patient — auto-registro en cartilla */
  @Post(':slug/register-patient')
  @UseGuards(CaptchaGuard)
  registerPatient(@Param('slug') slug: string, @Body() dto: PublicRegisterPatientDto) {
    return this.bookingService.registerPatientPublic(slug, dto);
  }
}

// ═══════════════════════════════════════════════════════════
// PRIVADO — médico autenticado
// ═══════════════════════════════════════════════════════════

@Controller('api/v1/booking')
export class BookingController {
  constructor(private bookingService: BookingService) {}

  /** GET /booking/settings — configuración de reservas */
  @Get('settings')
  getSettings(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
  ) {
    return this.bookingService.getSettings(orgId, doctorId);
  }

  /** PUT /booking/settings — actualizar configuración */
  @Put('settings')
  updateSettings(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: BookingSettingsDto,
  ) {
    return this.bookingService.updateSettings(orgId, doctorId, dto);
  }

  /** GET /booking/requests — solicitudes pendientes */
  @Get('requests')
  getPending(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
  ) {
    return this.bookingService.getPendingRequests(orgId, doctorId);
  }

  /** POST /booking/requests/:id/approve */
  @Post('requests/:id/approve')
  approve(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
  ) {
    return this.bookingService.approveRequest(orgId, doctorId, id);
  }

  /** POST /booking/requests/:id/reject */
  @Post('requests/:id/reject')
  reject(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookingService.rejectRequest(orgId, doctorId, id, dto?.reason);
  }

  /** PATCH /booking/requests/:id/confirm-payment */
  @Patch('requests/:id/confirm-payment')
  confirmPayment(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
  ) {
    return this.bookingService.confirmPayment(orgId, doctorId, id);
  }

  /** POST /booking/appointments/:id/no-show */
  @Post('appointments/:id/no-show')
  noShow(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
  ) {
    return this.bookingService.registerNoShow(orgId, doctorId, id);
  }
}
