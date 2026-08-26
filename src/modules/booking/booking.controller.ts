import { Controller, Get, Post, Put, Patch, Body, Param, Query, Headers } from '@nestjs/common';
import { BookingService, BookingSettingsDto, CreateBookingDto } from './booking.service';

// ═══════════════════════════════════════════════════════════
// PÚBLICO — sin autenticación (para pacientes)
// ═══════════════════════════════════════════════════════════

@Controller('api/v1/public/booking')
export class PublicBookingController {
  constructor(private bookingService: BookingService) {}

  /** GET /public/booking/:slug — perfil del médico */
  @Get(':slug')
  getProfile(@Param('slug') slug: string) {
    return this.bookingService.getPublicProfile(slug);
  }

  /** GET /public/booking/:slug/slots?date=2026-09-01 */
  @Get(':slug/slots')
  getSlots(@Param('slug') slug: string, @Query('date') date: string) {
    return this.bookingService.getPublicSlots(slug, date);
  }

  /** POST /public/booking/:slug — crear reserva */
  @Post(':slug')
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
    @Body() body: { proofUrl: string; reference?: string },
  ) {
    return this.bookingService.uploadPaymentProof(token, body.proofUrl, body.reference);
  }

  /** POST /public/booking/status/:token/cancel */
  @Post('status/:token/cancel')
  cancel(@Param('token') token: string, @Body() body: { reason?: string }) {
    return this.bookingService.cancelBooking(token, body?.reason);
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
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
  ) {
    return this.bookingService.getSettings(orgId, doctorId);
  }

  /** PUT /booking/settings — actualizar configuración */
  @Put('settings')
  updateSettings(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Body() dto: BookingSettingsDto,
  ) {
    return this.bookingService.updateSettings(orgId, doctorId, dto);
  }

  /** GET /booking/requests — solicitudes pendientes */
  @Get('requests')
  getPending(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
  ) {
    return this.bookingService.getPendingRequests(orgId, doctorId);
  }

  /** POST /booking/requests/:id/approve */
  @Post('requests/:id/approve')
  approve(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Param('id') id: string,
  ) {
    return this.bookingService.approveRequest(orgId, doctorId, id);
  }

  /** POST /booking/requests/:id/reject */
  @Post('requests/:id/reject')
  reject(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.bookingService.rejectRequest(orgId, doctorId, id, body?.reason);
  }

  /** PATCH /booking/requests/:id/confirm-payment */
  @Patch('requests/:id/confirm-payment')
  confirmPayment(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Param('id') id: string,
  ) {
    return this.bookingService.confirmPayment(orgId, doctorId, id);
  }

  /** POST /booking/appointments/:id/no-show */
  @Post('appointments/:id/no-show')
  noShow(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Param('id') id: string,
  ) {
    return this.bookingService.registerNoShow(orgId, doctorId, id);
  }
}
