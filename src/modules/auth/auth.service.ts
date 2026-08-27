import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../database/database.service';

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  userType: 'doctor' | 'patient' | 'staff';
  patientId?: string;
  staffId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface DoctorOrg {
  org_doctor_id: string;
  org_id: string;
  org_name: string;
  org_type: string;
  role: string;
  is_owner: boolean;
}

export interface AuthSession extends AuthTokens {
  userType: 'doctor' | 'patient' | 'staff';
  user: Record<string, unknown>;
  organizations?: DoctorOrg[];
  subscription?: Record<string, unknown>;
  // Compat: la app vieja busca "doctor"
  doctor?: Record<string, unknown>;
}

export interface RegisterDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  medicalLicense: string;
  specialty?: string;
}

export interface RegisterPatientDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  dni?: string;
  dateOfBirth?: string;
  insuranceProvider?: string;
  insuranceNumber?: string;
  organizationId?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private db: DatabaseService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // LOGIN UNIFICADO
  // ═══════════════════════════════════════════════════════════

  async login(dto: LoginDto): Promise<AuthSession> {
    const email = dto.email.toLowerCase().trim();

    // Buscar en la vista unificada
    const user = await this.db.queryOne(
      `SELECT * FROM v_login_lookup WHERE email = $1 AND is_active = true`,
      [email],
    );

    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');

    switch (user.user_type) {
      case 'doctor': return this.buildDoctorSession(user);
      case 'patient': return this.buildPatientSession(user);
      case 'staff': return this.buildStaffSession(user);
      default: throw new UnauthorizedException('Tipo de usuario desconocido');
    }
  }

  // ─── Sesión de doctor ────────────────────────────────────

  private async buildDoctorSession(user: any): Promise<AuthSession> {
    const tokens = await this.generateTokens({
      sub: user.user_id, email: user.email, role: 'doctor', userType: 'doctor',
    });

    await this.updateRefreshToken('doctors', user.user_id, tokens.refreshToken);
    await this.db.query('UPDATE doctors SET last_login_at = NOW() WHERE id = $1', [user.user_id]);

    const { password_hash, ...safeUser } = user;

    const organizations = await this.db.queryMany(
      `SELECT org_doctor_id, org_id, org_name, org_type, role, is_owner
       FROM v_doctor_orgs WHERE doctor_id = $1 ORDER BY org_name`,
      [user.user_id],
    );

    const subscription = await this.db.queryOne(
      `SELECT plan, is_pro, max_appointments_per_month, max_organizations
       FROM v_doctor_subscription WHERE doctor_id = $1`,
      [user.user_id],
    );

    this.logger.log(`Doctor login: ${user.email}`);
    return {
      ...tokens,
      userType: 'doctor',
      user: safeUser,
      doctor: safeUser,  // backward compat
      organizations,
      subscription: subscription || { plan: 'free', is_pro: false },
    };
  }

  // ─── Sesión de paciente ──────────────────────────────────

  private async buildPatientSession(user: any): Promise<AuthSession> {
    const tokens = await this.generateTokens({
      sub: user.user_id, email: user.email, role: 'patient',
      userType: 'patient', patientId: user.patient_id,
    });

    await this.updateRefreshToken('patient_auth', user.user_id, tokens.refreshToken);
    await this.db.query('UPDATE patient_auth SET last_login_at = NOW() WHERE id = $1', [user.user_id]);

    // Datos del paciente
    const patient = await this.db.queryOne(
      `SELECT id, first_name, last_name, email, phone, dni, date_of_birth, gender,
              insurance_provider, insurance_plan, insurance_number
       FROM patients WHERE id = $1`, [user.patient_id],
    );

    // Turnos próximos
    const upcomingAppts = await this.db.queryMany(
      `SELECT a.id, a.date, a.start_time, a.end_time, a.status, a.reason,
              d.first_name || ' ' || d.last_name AS doctor_name, d.specialty,
              o.name AS org_name, o.address AS org_address
       FROM appointments a
       JOIN organization_doctors od ON od.id = a.org_doctor_id
       JOIN doctors d ON d.id = od.doctor_id
       JOIN organizations o ON o.id = a.organization_id
       WHERE a.patient_id = $1 AND a.date >= CURRENT_DATE AND a.status NOT IN ('cancelled','no_show')
       ORDER BY a.date, a.start_time LIMIT 10`,
      [user.patient_id],
    );

    this.logger.log(`Patient login: ${user.email}`);
    return {
      ...tokens,
      userType: 'patient',
      user: { ...patient, upcomingAppointments: upcomingAppts },
    };
  }

  // ─── Sesión de staff/admin ───────────────────────────────

  private async buildStaffSession(user: any): Promise<AuthSession> {
    const tokens = await this.generateTokens({
      sub: user.user_id, email: user.email, role: 'staff',
      userType: 'staff', staffId: user.staff_id,
    });

    await this.updateRefreshToken('staff', user.user_id, tokens.refreshToken);
    await this.db.query('UPDATE staff SET last_login_at = NOW() WHERE id = $1', [user.user_id]);

    const { password_hash, ...safeUser } = user;

    // Organizaciones del staff con roles
    const organizations = await this.db.queryMany(
      `SELECT om.id AS member_id, om.organization_id AS org_id,
              o.name AS org_name, o.type AS org_type,
              r.code AS role_code, r.name AS role_name,
              r.level AS role_level, r.category AS role_category
       FROM organization_members om
       JOIN organizations o ON o.id = om.organization_id
       JOIN roles r ON r.id = om.role_id
       WHERE om.staff_id = $1 AND om.is_active = true
       ORDER BY o.name`,
      [user.staff_id],
    );

    this.logger.log(`Staff login: ${user.email}`);
    return {
      ...tokens,
      userType: 'staff',
      user: safeUser,
      organizations,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // REGISTRO DE DOCTOR (existente)
  // ═══════════════════════════════════════════════════════════

  async register(dto: RegisterDto): Promise<AuthSession> {
    const exists = await this.db.queryOne(
      'SELECT id FROM doctors WHERE email = $1 OR medical_license = $2',
      [dto.email.toLowerCase(), dto.medicalLicense],
    );
    if (exists) throw new ConflictException('Email o matrícula ya registrados');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const doctor = await this.db.queryOne<{ id: string; email: string; role: string }>(
      `INSERT INTO doctors (email, password_hash, first_name, last_name, phone, medical_license, specialty)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, role`,
      [dto.email.toLowerCase(), passwordHash, dto.firstName, dto.lastName,
       dto.phone || null, dto.medicalLicense, dto.specialty || 'Clínica médica'],
    );

    return this.buildDoctorSession({ ...doctor, user_id: doctor.id, password_hash: passwordHash, user_type: 'doctor' });
  }

  // ═══════════════════════════════════════════════════════════
  // REGISTRO DE PACIENTE (nuevo)
  // ═══════════════════════════════════════════════════════════

  async registerPatient(dto: RegisterPatientDto): Promise<AuthSession> {
    const email = dto.email.toLowerCase().trim();

    // ¿Ya tiene cuenta?
    const existingAuth = await this.db.queryOne('SELECT id FROM patient_auth WHERE email = $1', [email]);
    if (existingAuth) throw new ConflictException('Ya tenés una cuenta con este email');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Buscar si ya existe como paciente (quizás lo cargó el médico)
    let patient = await this.db.queryOne(
      `SELECT id FROM patients WHERE email = $1 OR dni = $2`,
      [email, dto.dni || ''],
    );

    if (!patient) {
      // Crear paciente nuevo
      patient = await this.db.queryOne(
        `INSERT INTO patients (organization_id, first_name, last_name, email, phone, dni, date_of_birth,
          insurance_provider, insurance_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9) RETURNING id`,
        [
          dto.organizationId || null, dto.firstName, dto.lastName, email,
          dto.phone, dto.dni || null, dto.dateOfBirth || null,
          dto.insuranceProvider || null, dto.insuranceNumber || null,
        ],
      );
    }

    // Crear auth
    const auth = await this.db.queryOne(
      `INSERT INTO patient_auth (patient_id, email, password_hash, phone) VALUES ($1,$2,$3,$4) RETURNING id`,
      [patient.id, email, passwordHash, dto.phone],
    );

    this.logger.log(`Patient registered: ${email}`);
    return this.buildPatientSession({
      user_id: auth.id, email, patient_id: patient.id,
      password_hash: passwordHash, user_type: 'patient',
      first_name: dto.firstName, last_name: dto.lastName,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // REGISTRO DE STAFF (nuevo)
  // ═══════════════════════════════════════════════════════════

  async registerStaff(dto: {
    email: string; password: string; firstName: string; lastName: string;
    phone?: string; organizationId: string; roleCode: string;
  }): Promise<AuthSession> {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.db.queryOne('SELECT id FROM staff WHERE email = $1', [email]);
    if (exists) throw new ConflictException('Email ya registrado');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const staffMember = await this.db.queryOne(
      `INSERT INTO staff (email, password_hash, first_name, last_name, phone)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [email, passwordHash, dto.firstName, dto.lastName, dto.phone || null],
    );

    // Asignar rol en la org
    const role = await this.db.queryOne('SELECT id FROM roles WHERE code = $1', [dto.roleCode]);
    if (role) {
      await this.db.query(
        `INSERT INTO organization_members (organization_id, staff_id, role_id, is_active)
         VALUES ($1,$2,$3,true)`,
        [dto.organizationId, staffMember.id, role.id],
      );
    }

    this.logger.log(`Staff registered: ${email} as ${dto.roleCode}`);
    return this.buildStaffSession({
      user_id: staffMember.id, email, staff_id: staffMember.id,
      password_hash: passwordHash, user_type: 'staff',
      first_name: dto.firstName, last_name: dto.lastName,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // REFRESH / LOGOUT / CHANGE PASSWORD
  // ═══════════════════════════════════════════════════════════

  async refreshTokens(userId: string, refreshToken: string): Promise<AuthTokens> {
    // Intentar las 3 tablas
    for (const table of ['doctors', 'patient_auth', 'staff']) {
      const user = await this.db.queryOne(
        `SELECT id, email, refresh_token_hash FROM ${table} WHERE id = $1`,
        [userId],
      );
      if (user?.refresh_token_hash) {
        const valid = await bcrypt.compare(refreshToken, user.refresh_token_hash);
        if (valid) {
          const userType = table === 'doctors' ? 'doctor' : table === 'patient_auth' ? 'patient' : 'staff';
          const tokens = await this.generateTokens({
            sub: user.id, email: user.email, role: userType, userType: userType as any,
          });
          await this.updateRefreshToken(table, user.id, tokens.refreshToken);
          return tokens;
        }
      }
    }
    throw new UnauthorizedException('Token inválido');
  }

  async logout(userId: string): Promise<void> {
    for (const table of ['doctors', 'patient_auth', 'staff']) {
      await this.db.query(`UPDATE ${table} SET refresh_token_hash = NULL WHERE id = $1`, [userId]);
    }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    // Buscar en las 3 tablas
    for (const table of ['doctors', 'patient_auth', 'staff']) {
      const user = await this.db.queryOne(`SELECT id, password_hash FROM ${table} WHERE id = $1`, [userId]);
      if (user) {
        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) throw new UnauthorizedException('Contraseña actual incorrecta');
        const newHash = await bcrypt.hash(newPassword, 12);
        await this.db.query(`UPDATE ${table} SET password_hash = $1, refresh_token_hash = NULL WHERE id = $2`, [newHash, userId]);
        return;
      }
    }
    throw new UnauthorizedException('Usuario no encontrado');
  }

  // ─── Helpers ────────────────────────────────────────────

  private async generateTokens(payload: TokenPayload): Promise<AuthTokens> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: '30m',
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(table: string, userId: string, refreshToken: string): Promise<void> {
    const hash = await bcrypt.hash(refreshToken, 10);
    await this.db.query(`UPDATE ${table} SET refresh_token_hash = $1 WHERE id = $2`, [hash, userId]);
  }
}
