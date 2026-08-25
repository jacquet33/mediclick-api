import { Injectable, NotFoundException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface CreateOrgDto {
  name: string;
  type: 'consultorio' | 'centro_medico' | 'clinica' | 'hospital' | 'individual';
  cuit?: string;
  taxName?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  defaultSlotDuration?: number;
}

export interface InviteDoctorDto {
  email: string;
  role: 'doctor' | 'admin';
}

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(private db: DatabaseService) {}

  /** Crear organización — el doctor queda como owner */
  async create(doctorId: string, dto: CreateOrgDto) {
    return this.db.transaction(async (client) => {
      // 1. Crear la organización
      const org = await client.query(
        `INSERT INTO organizations (name, type, cuit, tax_name, phone, email, address, city, province, postal_code, default_slot_duration)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [dto.name, dto.type, dto.cuit, dto.taxName, dto.phone, dto.email,
         dto.address, dto.city, dto.province, dto.postalCode, dto.defaultSlotDuration || 30]
      );

      const orgId = org.rows[0].id;

      // 2. Vincular doctor como owner
      const orgDoctor = await client.query(
        `INSERT INTO organization_doctors (organization_id, doctor_id, role, is_owner)
         VALUES ($1, $2, 'owner', true)
         RETURNING *`,
        [orgId, doctorId]
      );

      this.logger.log(`Org created: ${dto.name} (${dto.type}) by doctor ${doctorId}`);

      return {
        organization: org.rows[0],
        membership: orgDoctor.rows[0],
      };
    });
  }

  /** Auto-crear organización "individual" para doctor nuevo */
  async createIndividualOrg(doctorId: string, doctorName: string) {
    return this.create(doctorId, {
      name: `Dr. ${doctorName}`,
      type: 'individual',
    });
  }

  /** Obtener organizaciones de un doctor */
  async getDoctorOrganizations(doctorId: string) {
    return this.db.queryMany(
      `SELECT * FROM v_doctor_orgs WHERE doctor_id = $1 ORDER BY org_name`,
      [doctorId]
    );
  }

  /** Obtener detalle de organización */
  async getById(orgId: string, doctorId: string) {
    await this.assertMembership(orgId, doctorId);

    return this.db.queryOne(
      `SELECT o.*, 
              (SELECT COUNT(*) FROM patients p WHERE p.organization_id = o.id AND p.is_active) AS patient_count,
              (SELECT COUNT(*) FROM organization_doctors od WHERE od.organization_id = o.id AND od.is_active) AS doctor_count
       FROM organizations o
       WHERE o.id = $1`,
      [orgId]
    );
  }

  /** Actualizar organización (solo owner/admin) */
  async update(orgId: string, doctorId: string, dto: Partial<CreateOrgDto>) {
    await this.assertRole(orgId, doctorId, ['owner', 'admin']);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const mapping: Record<string, string> = {
      name: 'name', phone: 'phone', email: 'email',
      address: 'address', city: 'city', province: 'province',
      postalCode: 'postal_code', cuit: 'cuit', taxName: 'tax_name',
      defaultSlotDuration: 'default_slot_duration',
    };

    for (const [key, column] of Object.entries(mapping)) {
      if (dto[key] !== undefined) {
        fields.push(`${column} = $${idx}`);
        values.push(dto[key]);
        idx++;
      }
    }

    if (fields.length === 0) return this.getById(orgId, doctorId);

    values.push(orgId);
    return this.db.queryOne(
      `UPDATE organizations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
  }

  /** Listar doctores de una organización */
  async getDoctors(orgId: string, doctorId: string) {
    await this.assertMembership(orgId, doctorId);

    return this.db.queryMany(
      `SELECT * FROM v_org_doctors WHERE organization_id = $1 AND is_active = true ORDER BY full_name`,
      [orgId]
    );
  }

  /** Estadísticas de la organización */
  async getStats(orgId: string, doctorId: string) {
    await this.assertMembership(orgId, doctorId);

    const stats = await this.db.queryOne(`
      SELECT
        (SELECT COUNT(*) FROM patients WHERE organization_id = $1 AND is_active) AS total_patients,
        (SELECT COUNT(*) FROM organization_doctors WHERE organization_id = $1 AND is_active) AS total_doctors,
        (SELECT COUNT(*) FROM appointments WHERE organization_id = $1 AND date = CURRENT_DATE AND status NOT IN ('cancelled')) AS today_appointments,
        (SELECT COUNT(*) FROM prescriptions WHERE organization_id = $1 AND status = 'active') AS active_prescriptions,
        (SELECT COUNT(*) FROM appointments WHERE organization_id = $1 AND date = CURRENT_DATE AND status = 'completed') AS completed_today,
        (SELECT COUNT(*) FROM conversations c 
         JOIN messages m ON m.conversation_id = c.id 
         WHERE c.organization_id = $1 AND m.is_read = false AND m.sender_type = 'patient') AS unread_messages
    `, [orgId]);

    return stats;
  }

  // ─── Invitaciones ──────────────────────────────────────

  /** Invitar doctor a la organización */
  async inviteDoctor(orgId: string, invitedById: string, dto: InviteDoctorDto) {
    await this.assertRole(orgId, invitedById, ['owner', 'admin']);

    // Verificar que no esté ya en la org
    const existing = await this.db.queryOne(
      `SELECT id FROM organization_doctors 
       WHERE organization_id = $1 AND doctor_id = (SELECT id FROM doctors WHERE email = $2) AND is_active = true`,
      [orgId, dto.email]
    );

    if (existing) {
      throw new ConflictException('Este doctor ya pertenece a la organización');
    }

    // Verificar invitación duplicada
    const existingInvite = await this.db.queryOne(
      `SELECT id FROM invitations 
       WHERE organization_id = $1 AND invited_email = $2 AND status = 'pending'`,
      [orgId, dto.email]
    );

    if (existingInvite) {
      throw new ConflictException('Ya existe una invitación pendiente para este email');
    }

    // Buscar si el doctor ya tiene cuenta
    const doctorExists = await this.db.queryOne(
      `SELECT id FROM doctors WHERE email = $1`,
      [dto.email]
    );

    const invitation = await this.db.queryOne(
      `INSERT INTO invitations (organization_id, invited_by, invited_email, invited_doctor_id, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [orgId, invitedById, dto.email, doctorExists?.id || null, dto.role]
    );

    this.logger.log(`Invitation sent to ${dto.email} for org ${orgId}`);
    return invitation;
  }

  /** Aceptar invitación */
  async acceptInvitation(invitationId: string, doctorId: string) {
    const invitation = await this.db.queryOne(
      `SELECT * FROM invitations WHERE id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [invitationId]
    );

    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada o expirada');
    }

    // Verificar que el doctor es el invitado
    const doctor = await this.db.queryOne(
      `SELECT email FROM doctors WHERE id = $1`,
      [doctorId]
    );

    if (doctor.email !== invitation.invited_email) {
      throw new ForbiddenException('Esta invitación no es para tu cuenta');
    }

    return this.db.transaction(async (client) => {
      // Crear vínculo
      await client.query(
        `INSERT INTO organization_doctors (organization_id, doctor_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, doctor_id) DO UPDATE SET is_active = true, role = $3, left_at = NULL`,
        [invitation.organization_id, doctorId, invitation.role]
      );

      // Marcar invitación como aceptada
      await client.query(
        `UPDATE invitations SET status = 'accepted', accepted_at = NOW(), invited_doctor_id = $1 WHERE id = $2`,
        [doctorId, invitationId]
      );

      this.logger.log(`Doctor ${doctorId} joined org ${invitation.organization_id}`);
      return { message: 'Invitación aceptada' };
    });
  }

  /** Invitaciones recibidas por un doctor */
  async getReceivedInvitations(doctorEmail: string) {
    return this.db.queryMany(
      `SELECT i.*, o.name AS org_name, o.type AS org_type,
              d.first_name || ' ' || d.last_name AS invited_by_name
       FROM invitations i
       JOIN organizations o ON o.id = i.organization_id
       JOIN doctors d ON d.id = i.invited_by
       WHERE i.invited_email = $1 AND i.status = 'pending' AND i.expires_at > NOW()
       ORDER BY i.created_at DESC`,
      [doctorEmail]
    );
  }

  /** Desvincular doctor de una organización */
  async removeDoctor(orgId: string, requesterId: string, targetDoctorId: string) {
    await this.assertRole(orgId, requesterId, ['owner', 'admin']);

    // No puede removerse al owner
    const target = await this.db.queryOne(
      `SELECT is_owner FROM organization_doctors WHERE organization_id = $1 AND doctor_id = $2`,
      [orgId, targetDoctorId]
    );

    if (target?.is_owner) {
      throw new ForbiddenException('No se puede remover al propietario de la organización');
    }

    await this.db.query(
      `UPDATE organization_doctors SET is_active = false, left_at = NOW() 
       WHERE organization_id = $1 AND doctor_id = $2`,
      [orgId, targetDoctorId]
    );

    return { message: 'Doctor desvinculado' };
  }

  // ─── Helpers de autorización ───────────────────────────

  /** Verificar que el doctor pertenece a la org */
  async assertMembership(orgId: string, doctorId: string): Promise<void> {
    const member = await this.db.queryOne(
      `SELECT id FROM organization_doctors 
       WHERE organization_id = $1 AND doctor_id = $2 AND is_active = true`,
      [orgId, doctorId]
    );

    if (!member) {
      throw new ForbiddenException('No tenés acceso a esta organización');
    }
  }

  /** Verificar que el doctor tiene un rol específico */
  async assertRole(orgId: string, doctorId: string, allowedRoles: string[]): Promise<void> {
    const member = await this.db.queryOne(
      `SELECT role FROM organization_doctors 
       WHERE organization_id = $1 AND doctor_id = $2 AND is_active = true`,
      [orgId, doctorId]
    );

    if (!member) {
      throw new ForbiddenException('No tenés acceso a esta organización');
    }

    if (!allowedRoles.includes(member.role)) {
      throw new ForbiddenException(`Se requiere rol: ${allowedRoles.join(' o ')}`);
    }
  }

  /** Obtener org_doctor_id a partir de orgId + doctorId */
  async getOrgDoctorId(orgId: string, doctorId: string): Promise<string> {
    const result = await this.db.queryOne(
      `SELECT id FROM organization_doctors 
       WHERE organization_id = $1 AND doctor_id = $2 AND is_active = true`,
      [orgId, doctorId]
    );

    if (!result) {
      throw new ForbiddenException('Doctor no pertenece a esta organización');
    }

    return result.id;
  }
}
