import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(private db: DatabaseService) {}

  /** Listar todos los roles activos */
  async listRoles(orgType?: string) {
    let query = `
      SELECT r.*, 
        (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
      FROM roles r
      WHERE r.is_active = true
    `;
    const params: any[] = [];

    if (orgType) {
      params.push(orgType);
      query += ` AND $${params.length} = ANY(r.allowed_org_types)`;
    }

    query += ` ORDER BY r.sort_order, r.name`;
    return this.db.queryMany(query, params);
  }

  /** Obtener un rol con sus permisos */
  async getRoleWithPermissions(roleId: string) {
    const role = await this.db.queryOne(
      `SELECT * FROM roles WHERE id = $1`,
      [roleId],
    );

    if (!role) return null;

    const permissions = await this.db.queryMany(
      `SELECT p.* FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = $1
       ORDER BY p.module, p.sort_order`,
      [roleId],
    );

    return { ...role, permissions };
  }

  /** Obtener rol por código */
  async getRoleByCode(code: string) {
    return this.db.queryOne(
      `SELECT * FROM roles WHERE code = $1 AND is_active = true`,
      [code],
    );
  }

  /** Listar permisos, agrupados por módulo */
  async listPermissions() {
    return this.db.queryMany(
      `SELECT * FROM permissions ORDER BY module, sort_order`,
    );
  }

  /** Permisos de un miembro específico */
  async getMemberPermissions(memberId: string) {
    return this.db.queryMany(
      `SELECT p.code, p.name, p.module
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN organization_members om ON om.role_id = rp.role_id
       WHERE om.id = $1 AND om.is_active = true
       ORDER BY p.module, p.sort_order`,
      [memberId],
    );
  }

  /** Verificar si un miembro tiene un permiso específico */
  async hasPermission(orgId: string, doctorId: string, permissionCode: string): Promise<boolean> {
    const result = await this.db.queryOne(
      `SELECT 1 FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN organization_members om ON om.role_id = rp.role_id
       WHERE om.organization_id = $1
         AND om.doctor_id = $2
         AND om.is_active = true
         AND p.code = $3
       LIMIT 1`,
      [orgId, doctorId, permissionCode],
    );
    return !!result;
  }

  /** Miembros de una organización con rol expandido */
  async getOrgMembers(orgId: string) {
    return this.db.queryMany(
      `SELECT * FROM v_org_members WHERE organization_id = $1 AND is_active = true ORDER BY role_level, full_name`,
      [orgId],
    );
  }

  /** Cambiar rol de un miembro */
  async changeMemberRole(orgId: string, memberId: string, newRoleCode: string) {
    const role = await this.getRoleByCode(newRoleCode);
    if (!role) throw new Error(`Rol "${newRoleCode}" no encontrado`);

    await this.db.query(
      `UPDATE organization_members SET role_id = $1 WHERE id = $2 AND organization_id = $3`,
      [role.id, memberId, orgId],
    );

    // Sync to organization_doctors if it's a doctor
    const member = await this.db.queryOne(
      `SELECT doctor_id FROM organization_members WHERE id = $1`,
      [memberId],
    );
    if (member?.doctor_id) {
      await this.db.query(
        `UPDATE organization_doctors SET role_id = $1 WHERE organization_id = $2 AND doctor_id = $3`,
        [role.id, orgId, member.doctor_id],
      );
    }

    this.logger.log(`Role changed: member ${memberId} → ${newRoleCode} in org ${orgId}`);
    return this.db.queryOne(
      `SELECT * FROM v_org_members WHERE member_id = $1`,
      [memberId],
    );
  }

  /** Roles disponibles para un tipo de organización */
  async getRolesForOrgType(orgType: string) {
    return this.db.queryMany(
      `SELECT id, code, name, description, category, is_clinical, requires_license, icon, color
       FROM roles
       WHERE is_active = true AND $1 = ANY(allowed_org_types)
       ORDER BY sort_order`,
      [orgType],
    );
  }
}
