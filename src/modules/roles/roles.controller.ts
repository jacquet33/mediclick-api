import { Controller, Get, Put, Param, Body, Query } from '@nestjs/common';
import { RolesService } from './roles.service';
import { DoctorId, OrgId } from '../../common/decorators/current-user.decorator';

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

  /** GET /organizations/:orgId/members */
  @Get()
  list(@Param('orgId') orgId: string) {
    return this.service.getOrgMembers(orgId);
  }

  /** GET /organizations/:orgId/members/:memberId/permissions */
  @Get(':memberId/permissions')
  permissions(@Param('memberId') memberId: string) {
    return this.service.getMemberPermissions(memberId);
  }

  /** PUT /organizations/:orgId/members/:memberId/role */
  @Put(':memberId/role')
  changeRole(
    @Param('orgId') orgId: string,
    @Param('memberId') memberId: string,
    @Body('roleCode') roleCode: string,
  ) {
    return this.service.changeMemberRole(orgId, memberId, roleCode);
  }
}
