import { ForbiddenException, Post, Delete, Controller, Get, Put, Param, Body, Query } from '@nestjs/common';
import { RolesService } from './roles.service';
import { DoctorId, OrgId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';

@Controller('api/v1/roles')
export class RolesController {
  constructor(private service: RolesService) {}

  /** GET /roles — listar roles (filtrar por tipo de org) */
  @Get()
  list(@Query('orgType') orgType?: string) {
    return this.service.listRoles(orgType);
  }

  /** GET /roles/permissions — todos los permisos */
  @Get('permissions')
  permissions() {
    return this.service.listPermissions();
  }

  /** GET /roles/:id — rol con permisos */
  @Get(':id')
  getRole(@Param('id') id: string) {
    return this.service.getRoleWithPermissions(id);
  }

  /** GET /roles/for-org/:orgType — roles disponibles para un tipo de org */
  @Get('for-org/:orgType')
  forOrg(@Param('orgType') orgType: string) {
    return this.service.getRolesForOrgType(orgType);
  }
}

@Controller('api/v1/organizations/:orgId/members')
export class OrgMembersController {
  constructor(private service: RolesService) {}

  /** El :orgId de la URL tiene que ser el consultorio verificado por el guard (header x-organization-id) */
  private same(orgId: string, verified: string) {
    if (orgId !== verified) throw new ForbiddenException('No tenés acceso a esta organización');
  }

  private async mustAdmin(orgId: string, user: AuthUser) {
    if (user.userType !== 'doctor' || !(await this.service.isOrgAdmin(orgId, user.doctorId))) {
      throw new ForbiddenException('Solo el médico titular puede administrar el equipo');
    }
  }

  /** GET /organizations/:orgId/members */
  @Get()
  list(@Param('orgId') orgId: string, @OrgId() verified: string) {
    this.same(orgId, verified);
    return this.service.getOrgMembers(orgId);
  }

  /** GET /organizations/:orgId/members/:memberId/permissions */
  @Get(':memberId/permissions')
  permissions(@Param('orgId') orgId: string, @OrgId() verified: string, @Param('memberId') memberId: string) {
    this.same(orgId, verified);
    return this.service.getMemberPermissions(memberId);
  }

  /** PUT /organizations/:orgId/members/:memberId/role */
  @Put(':memberId/role')
  async changeRole(
    @Param('orgId') orgId: string,
    @OrgId() verified: string,
    @CurrentUser() user: AuthUser,
    @Param('memberId') memberId: string,
    @Body('roleCode') roleCode: string,
  ) {
    this.same(orgId, verified);
    await this.mustAdmin(orgId, user);
    return this.service.changeMemberRole(orgId, memberId, roleCode);
  }

  /** POST /organizations/:orgId/members/staff — alta de secretaría (solo el titular) */
  @Post('staff')
  async addStaff(
    @Param('orgId') orgId: string,
    @OrgId() verified: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: { firstName: string; lastName: string; email: string; password: string; phone?: string; roleCode?: string },
  ) {
    this.same(orgId, verified);
    await this.mustAdmin(orgId, user);
    return this.service.createStaff(orgId, dto);
  }

  /** DELETE /organizations/:orgId/members/staff/:staffId — quita el acceso */
  @Delete('staff/:staffId')
  async removeStaff(@Param('orgId') orgId: string, @OrgId() verified: string, @CurrentUser() user: AuthUser, @Param('staffId') staffId: string) {
    this.same(orgId, verified);
    await this.mustAdmin(orgId, user);
    return this.service.removeStaff(orgId, staffId);
  }
}
