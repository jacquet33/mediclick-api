import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../database/database.service';

export interface TokenPayload {
  sub: string;      // doctor id
  email: string;
  role: string;
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
  doctor: Record<string, unknown>;
  organizations: DoctorOrg[];
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

  /** Registro de nuevo doctor */
  async register(dto: RegisterDto): Promise<AuthSession> {
    // Verificar duplicados
    const exists = await this.db.queryOne(
      'SELECT id FROM doctors WHERE email = $1 OR medical_license = $2',
      [dto.email.toLowerCase(), dto.medicalLicense],
    );

    if (exists) {
      throw new ConflictException('Email o matrícula ya registrados');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const doctor = await this.db.queryOne<{ id: string; email: string; role: string }>(
      `INSERT INTO doctors (email, password_hash, first_name, last_name, phone, medical_license, specialty)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, role`,
      [
        dto.email.toLowerCase(),
        passwordHash,
        dto.firstName,
        dto.lastName,
        dto.phone || null,
        dto.medicalLicense,
        dto.specialty || 'Clínica médica',
      ],
    );

    const tokens = await this.generateTokens({
      sub: doctor.id,
      email: doctor.email,
      role: doctor.role,
    });

    await this.updateRefreshToken(doctor.id, tokens.refreshToken);

    const organizations = await this.db.queryMany(
      `SELECT org_doctor_id, org_id, org_name, org_type, role, is_owner
       FROM v_doctor_orgs WHERE doctor_id = $1`,
      [doctor.id],
    );

    this.logger.log(`Doctor registered: ${doctor.email}`);
    return { ...tokens, doctor, organizations };
  }

  /** Login con email y password */
  async login(dto: LoginDto): Promise<AuthSession> {
    const doctor = await this.db.queryOne(
      `SELECT id, email, password_hash, first_name, last_name, role, 
              specialty, avatar_url, is_active, is_verified
       FROM doctors WHERE email = $1`,
      [dto.email.toLowerCase()],
    );

    if (!doctor || !doctor.is_active) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await bcrypt.compare(dto.password, doctor.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const tokens = await this.generateTokens({
      sub: doctor.id,
      email: doctor.email,
      role: doctor.role,
    });

    await this.updateRefreshToken(doctor.id, tokens.refreshToken);

    // Actualizar último login
    await this.db.query(
      'UPDATE doctors SET last_login_at = NOW() WHERE id = $1',
      [doctor.id],
    );

    const { password_hash, ...safeDoctor } = doctor;

    // La app necesita saber a qué consultorios pertenece para poder
    // mandar el header x-organization-id en las siguientes llamadas
    const organizations = await this.db.queryMany(
      `SELECT org_doctor_id, org_id, org_name, org_type, role, is_owner
       FROM v_doctor_orgs WHERE doctor_id = $1 ORDER BY org_name`,
      [doctor.id],
    );

    return { ...tokens, doctor: safeDoctor, organizations };
  }

  /** Refresh de tokens */
  async refreshTokens(doctorId: string, refreshToken: string): Promise<AuthTokens> {
    const doctor = await this.db.queryOne(
      'SELECT id, email, role, refresh_token_hash FROM doctors WHERE id = $1 AND is_active = true',
      [doctorId],
    );

    if (!doctor || !doctor.refresh_token_hash) {
      throw new UnauthorizedException('Acceso denegado');
    }

    const rtValid = await bcrypt.compare(refreshToken, doctor.refresh_token_hash);
    if (!rtValid) {
      throw new UnauthorizedException('Token inválido');
    }

    const tokens = await this.generateTokens({
      sub: doctor.id,
      email: doctor.email,
      role: doctor.role,
    });

    await this.updateRefreshToken(doctor.id, tokens.refreshToken);
    return tokens;
  }

  /** Logout - invalidar refresh token */
  async logout(doctorId: string): Promise<void> {
    await this.db.query(
      'UPDATE doctors SET refresh_token_hash = NULL WHERE id = $1',
      [doctorId],
    );
  }

  /** Cambiar contraseña */
  async changePassword(doctorId: string, currentPassword: string, newPassword: string): Promise<void> {
    const doctor = await this.db.queryOne(
      'SELECT password_hash FROM doctors WHERE id = $1',
      [doctorId],
    );

    if (!doctor) throw new UnauthorizedException('Doctor no encontrado');

    const valid = await bcrypt.compare(currentPassword, doctor.password_hash);
    if (!valid) throw new UnauthorizedException('Contraseña actual incorrecta');

    const newHash = await bcrypt.hash(newPassword, 12);
    await this.db.query(
      'UPDATE doctors SET password_hash = $1, refresh_token_hash = NULL WHERE id = $2',
      [newHash, doctorId],
    );
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

  private async updateRefreshToken(doctorId: string, refreshToken: string): Promise<void> {
    const hash = await bcrypt.hash(refreshToken, 10);
    await this.db.query(
      'UPDATE doctors SET refresh_token_hash = $1 WHERE id = $2',
      [hash, doctorId],
    );
  }
}
