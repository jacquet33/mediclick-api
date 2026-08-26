import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { OrganizationService, CreateOrgDto, InviteDoctorDto } from './organization.service';
import { DoctorId, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/organizations')
export class OrganizationController {
  constructor(private orgService: OrganizationService) {}

  @Get()
  async getMyOrganizations(@DoctorId() doctorId: string) {
    return this.orgService.getDoctorOrganizations(doctorId);
  }

  @Post()
  async create(
    @DoctorId() doctorId: string,
    @Body() dto: CreateOrgDto,
  ) {
    return this.orgService.create(doctorId, dto);
  }

  @Get(':id')
  async getById(
    @Param('id') orgId: string,
    @DoctorId() doctorId: string,
  ) {
    return this.orgService.getById(orgId, doctorId);
  }

  @Put(':id')
  async update(
    @Param('id') orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: Partial<CreateOrgDto>,
  ) {
    return this.orgService.update(orgId, doctorId, dto);
  }

  @Get(':id/doctors')
  async getDoctors(
    @Param('id') orgId: string,
    @DoctorId() doctorId: string,
  ) {
    return this.orgService.getDoctors(orgId, doctorId);
  }

  @Get(':id/stats')
  async getStats(
    @Param('id') orgId: string,
    @DoctorId() doctorId: string,
  ) {
    return this.orgService.getStats(orgId, doctorId);
  }

  // ─── Invitaciones ──────────────────────────────────────

  @Post(':id/invite')
  async inviteDoctor(
    @Param('id') orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: InviteDoctorDto,
  ) {
    return this.orgService.inviteDoctor(orgId, doctorId, dto);
  }

  @Delete(':id/doctors/:targetDoctorId')
  @HttpCode(HttpStatus.OK)
  async removeDoctor(
    @Param('id') orgId: string,
    @Param('targetDoctorId') targetDoctorId: string,
    @DoctorId() doctorId: string,
  ) {
    return this.orgService.removeDoctor(orgId, doctorId, targetDoctorId);
  }
}

@Controller('api/v1/invitations')
export class InvitationController {
  constructor(private orgService: OrganizationService) {}

  @Get('received')
  async getReceivedInvitations(@CurrentUser('email') email: string) {
    return this.orgService.getReceivedInvitations(email);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('id') invitationId: string,
    @DoctorId() doctorId: string,
  ) {
    return this.orgService.acceptInvitation(invitationId, doctorId);
  }
}
