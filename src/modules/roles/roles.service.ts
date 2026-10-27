import { Injectable, Logger, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
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
  /** Médicos (organization_doctors) + staff (organization_members) del consultorio */
  async getOrgMembers(orgId: string) {
    return this.db.queryMany(
      `SELECT od.id AS member_id, 'doctor' AS member_type, d.id AS doctor_id, NULL::uuid AS staff_id,
              d.first_name || ' ' || d.last_name AS full_name, d.email, d.phone, d.specialty, d.medical_license,
              COALESCE(r.code, CASE WHEN od.is_owner THEN 'propietario' ELSE 'medico' END) AS role_code,
              COALESCE(r.name, CASE WHEN od.is_owner THEN 'Propietario' WHEN od.role::text = 'admin' THEN 'Administrador' ELSE 'Médico' END) AS role_name,
              od.is_owner, od.joined_at, 0 AS sort
       FROM organization_doctors od
       JOIN doctors d ON d.id = od.doctor_id
       LEFT JOIN roles r ON r.id = od.role_id
       WHERE od.organization_id = $1 AND od.is_active = true
       UNION ALL
       SELECT om.id, 'staff', NULL, s.id, s.first_name || ' ' || s.last_name, s.email, s.phone, s.specialty, s.license_number,
              r.code, r.name, false, om.joined_at, 1
       FROM organization_members om
       JOIN staff s ON s.id = om.staff_id
       JOIN roles r ON r.id = om.role_id
       WHERE om.organization_id = $1 AND om.is_active = true AND s.is_active = true
       ORDER BY sort, full_name`,
      [orgId],
    );
  }

  /** Roles que el médico puede dar a su equipo no médico */
  static readonly STAFF_ROLES = ['secretaria', 'recepcionista', 'administrador', 'facturacion', 'enfermero'];

  /** Alta de secretaría / recepción con email y contraseña inicial */
  async createStaff(orgId: string, dto: { firstName: string; lastName: string; email: string; password: string; phone?: string; roleCode?: string }) {
    const roleCode = dto.roleCode || 'secretaria';
    if (!RolesService.STAFF_ROLES.includes(roleCode)) throw new BadRequestException('Rol no permitido');
    const email = (dto.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Email inválido');
    if (!dto.firstName?.trim() || !dto.lastName?.trim()) throw new BadRequestException('Completá nombre y apellido');
    if (!dto.password || dto.password.length < 8) throw new BadRequestException('La contraseña tiene que tener al menos 8 caracteres');
    const role = await this.getRoleByCode(roleCode);
    if (!role) throw new BadRequestException('Rol no encontrado');
    const taken = await this.db.queryOne(`SELECT user_type FROM v_login_lookup WHERE lower(email) = $1 LIMIT 1`, [email]);

    let staff = await this.db.queryOne<{ id: string }>('SELECT id FROM staff WHERE lower(email) = $1', [email]);
    if (taken && !staff) throw new ConflictException('Ese email ya tiene una cuenta de médico o paciente');
    if (staff) {
      const ya = await this.db.queryOne('SELECT id FROM organization_members WHERE organization_id = $1 AND staff_id = $2', [orgId, staff.id]);
      if (ya) {
        await this.db.query('UPDATE organization_members SET is_active = true, role_id = $3, left_at = NULL WHERE organization_id = $1 AND staff_id = $2', [orgId, staff.id, role.id]);
        return { ok: true, staffId: staff.id, existing: true };
      }
    } else {
      const hash = await bcrypt.hash(dto.password, 12);
      staff = await this.db.queryOne<{ id: string }>(
        `INSERT INTO staff (email, password_hash, first_name, last_name, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [email, hash, dto.firstName.trim(), dto.lastName.trim(), dto.phone || null],
      );
    }
    await this.db.query(
      `INSERT INTO organization_members (organization_id, staff_id, role_id, is_active) VALUES ($1,$2,$3,true)`,
      [orgId, staff!.id, role.id],
    );
    this.logger.log(`Staff ${email} agregado a ${orgId} como ${roleCode}`);
    return { ok: true, staffId: staff!.id };
  }

  async removeStaff(orgId: string, staffId: string) {
    const r = await this.db.query(
      `UPDATE organization_members SET is_active = false, left_at = NOW() WHERE organization_id = $1 AND staff_id = $2 AND is_active = true`,
      [orgId, staffId],
    );
    if (!r.rowCount) throw new NotFoundException('No encontrado');
    return { ok: true };
  }

  /** ¿El médico es dueño o administrador del consultorio? */
  async isOrgAdmin(orgId: string, doctorId: string): Promise<boolean> {
    return !!(await this.db.queryOne(
      `SELECT 1 FROM organization_doctors WHERE organization_id = $1 AND doctor_id = $2 AND is_active = true AND (is_owner OR role::text IN ('owner','admin'))`,
      [orgId, doctorId],
    ));
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
