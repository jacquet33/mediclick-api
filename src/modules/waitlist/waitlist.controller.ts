import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { WaitlistService, AddToWaitlistDto } from './waitlist.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/guards/auth.guard';

// ═══════════════════════════════════════════════════════════
// PRIVADO — médico autenticado
// ═══════════════════════════════════════════════════════════

@Controller('api/v1/waitlist')
export class WaitlistController {
  constructor(private service: WaitlistService) {}

  /** POST /waitlist — agregar paciente */
  @Post()
  add(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: AddToWaitlistDto,
  ) {
    return this.service.add(orgId, doctorId, dto);
  }

  /** GET /waitlist — listar (filtrar por ?date= y ?status=) */
  @Get()
  list(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Query('date') date?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list(orgId, doctorId, { date, status });
  }

  /** GET /waitlist/stats */
  @Get('stats')
  stats(@OrgId() orgId: string, @DoctorId() doctorId: string) {
    return this.service.stats(orgId, doctorId);
  }

  /** DELETE /waitlist/:id */
  @Delete(':id')
  cancel(@OrgId() orgId: string, @Param('id') id: string) {
    return this.service.cancel(orgId, id);
  }

  /** POST /waitlist/:id/book — convertir en turno */
  @Post(':id/book')
  book(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Param('id') id: string,
    @Body() body: { startTime: string; endTime: string },
  ) {
    return this.service.bookFromWaitlist(orgId, doctorId, id, body.startTime, body.endTime);
  }
}

// ═══════════════════════════════════════════════════════════
// PÚBLICO — paciente pide ser avisado (desde página de booking)
// ═══════════════════════════════════════════════════════════

@Public()
@Controller('api/v1/public/waitlist')
export class PublicWaitlistController {
  constructor(private service: WaitlistService) {}

  /** POST /public/waitlist/:slug — avisame si se libera un turno */
  @Post(':slug')
  addPublic(
    @Param('slug') slug: string,
    @Body() dto: {
      firstName: string; lastName: string; phone: string; email?: string;
      desiredDate: string; preferredStartTime?: string; preferredEndTime?: string;
      reason?: string;
    },
  ) {
    return this.service.addPublic(slug, dto);
  }
}
