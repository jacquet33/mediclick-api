import { Controller, Get, Post, Put, Patch, Body, Param, Query } from '@nestjs/common';
import { BookingService, BookingSettingsDto, CreateBookingDto } from './booking.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/guards/auth.guard';
import { PublicThrottle } from '../../common/decorators/throttle.decorator';

// ═══════════════════════════════════════════════════════════
// PÚBLICO — sin autenticación (para pacientes)
// ═══════════════════════════════════════════════════════════

@Public()
@PublicThrottle()
@Controller('api/v1/public/booking')
export class PublicBookingController {
  constructor(private bookingService: BookingService) {}

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

  /** POST /public/booking/:slug/register-patient — auto-registro en cartilla */
  @Post(':slug/register-patient')
  registerPatient(@Param('slug') slug: string, @Body() dto: any) {
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
    @Body() body: { reason?: string },
  ) {
    return this.bookingService.rejectRequest(orgId, doctorId, id, body?.reason);
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
