import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AuthService } from './auth.service';

// ─── DTOs ───────────────────────────────────────────────────

export interface GoogleLoginDto {
  idToken: string;          // Token que devuelve Google Sign-In SDK
  /** 'patient' desde el portal web: si no hay cuenta se crea un paciente. Sin valor (apps) o 'doctor': se crea médico. */
  intent?: 'patient' | 'doctor';
  organizationId?: string;
}

export interface AppleLoginDto {
  identityToken: string;    // JWT que devuelve Apple Sign-In
  authorizationCode: string;
  fullName?: {
    givenName?: string;
    familyName?: string;
  };
  email?: string;           // Apple solo lo manda la primera vez
  intent?: 'patient' | 'doctor';
  organizationId?: string;
}

interface OAuthProfile {
  provider: 'google' | 'apple';
  providerId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

// ─── Service ────────────────────────────────────────────────

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private db: DatabaseService,
    private jwt: JwtService,
    private config: ConfigService,
    private auth: AuthService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // GOOGLE SIGN-IN
  // ═══════════════════════════════════════════════════════════

  async loginWithGoogle(dto: GoogleLoginDto) {
    // 1. Verificar el idToken con Google
    const profile = await this.verifyGoogleToken(dto.idToken);

    // 2. Si el email ya tiene cuenta (médico, paciente o staff) se entra con esa cuenta
    const existing = await this.db.queryOne(
      `SELECT * FROM v_login_lookup WHERE lower(email) = lower($1) AND is_active = true
       ORDER BY CASE user_type WHEN 'doctor' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END LIMIT 1`,
      [profile.email],
    );
    if (existing?.user_type === 'patient') return this.auth.buildPatientSession(existing);
    if (existing?.user_type === 'staff') return this.auth.buildStaffSession(existing);
    if (existing?.user_type === 'doctor' || dto.intent !== 'patient') return this.findOrCreateDoctor(profile);

    // 3. Paciente nuevo desde el portal
    return this.createPatientFromOAuth(profile, dto.organizationId);
  }

  private async createPatientFromOAuth(profile: OAuthProfile, organizationId?: string) {
    const email = profile.email.toLowerCase().trim();
    let patient = await this.db.queryOne('SELECT id FROM patients WHERE lower(email) = $1 LIMIT 1', [email]);
    if (!patient) {
      let orgId = organizationId;
      if (!orgId) {
        const org = await this.db.queryOne('SELECT id FROM organizations WHERE is_active = true ORDER BY created_at LIMIT 1');
        orgId = org?.id;
      }
      if (!orgId) throw new UnauthorizedException('No hay consultorios disponibles');
      patient = await this.db.queryOne(
        `INSERT INTO patients (organization_id, first_name, last_name, email) VALUES ($1,$2,$3,$4) RETURNING id`,
        [orgId, profile.firstName || 'Paciente', profile.lastName || '', email],
      );
    }
    // Sin contraseña: solo puede entrar con Google hasta que cree una
    const auth = await this.db.queryOne(
      `INSERT INTO patient_auth (patient_id, email, password_hash, phone) VALUES ($1,$2,$3,'') RETURNING id`,
      [patient.id, email, 'OAUTH_NO_PASSWORD'],
    );
    this.logger.log(`OAuth paciente nuevo: ${profile.provider} → ${email}`);
    const session = await this.auth.buildPatientSession({ user_id: auth.id, email, patient_id: patient.id, user_type: 'patient' });
    return { ...session, isNewUser: true };
  }

  private async verifyGoogleToken(idToken: string): Promise<OAuthProfile> {
    // Verificar contra Google OAuth2 API (gratis, sin librería)
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
    );

    if (!response.ok) {
      throw new UnauthorizedException('Token de Google inválido');
    }

    const payload = await response.json() as any;

    // Verificar que el token sea para nuestra app
    const clientIds = [
      this.config.get('GOOGLE_CLIENT_ID_IOS'),
      this.config.get('GOOGLE_CLIENT_ID_ANDROID'),
      this.config.get('GOOGLE_CLIENT_ID_WEB'),
      // El portal web toma su ID de GOOGLE_CLIENT_ID (ver /api/v1/public/config): también es válido
      this.config.get('GOOGLE_CLIENT_ID'),
    ].filter(Boolean);

    if (clientIds.length > 0 && !clientIds.includes(payload.aud)) {
      throw new UnauthorizedException('Token de Google no corresponde a esta app');
    }

    if (!payload.email_verified) {
      throw new UnauthorizedException('Email de Google no verificado');
    }

    return {
      provider: 'google',
      providerId: payload.sub,
      email: payload.email,
      firstName: payload.given_name,
      lastName: payload.family_name,
      avatarUrl: payload.picture,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // APPLE SIGN-IN
  // ═══════════════════════════════════════════════════════════

  async loginWithApple(dto: AppleLoginDto) {
    // 1. Verificar el identityToken con Apple
    const profile = await this.verifyAppleToken(dto);

    // 2. Si el email ya tiene cuenta (médico, paciente o staff) se entra con esa cuenta
    const existing = await this.db.queryOne(
      `SELECT * FROM v_login_lookup WHERE lower(email) = lower($1) AND is_active = true
       ORDER BY CASE user_type WHEN 'doctor' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END LIMIT 1`,
      [profile.email],
    );
    if (existing?.user_type === 'patient') return this.auth.buildPatientSession(existing);
    if (existing?.user_type === 'staff') return this.auth.buildStaffSession(existing);
    if (existing?.user_type === 'doctor' || dto.intent !== 'patient') return this.findOrCreateDoctor(profile);

    // 3. Paciente nuevo desde el portal
    return this.createPatientFromOAuth(profile, dto.organizationId);
  }


  private appleKeys: { at: number; keys: any[] } | null = null;

  /** Claves públicas de Apple (se cachean 6 h) */
  private async appleJwks(force = false): Promise<any[]> {
    if (!force && this.appleKeys && Date.now() - this.appleKeys.at < 6 * 3600_000) return this.appleKeys.keys;
    const r = await fetch('https://appleid.apple.com/auth/keys', { signal: AbortSignal.timeout(8000) })
      .catch(() => { throw new UnauthorizedException('No se pudo validar el acceso con Apple, probá de nuevo'); });
    if (!r.ok) throw new UnauthorizedException('No se pudo validar el acceso con Apple');
    const j: any = await r.json();
    this.appleKeys = { at: Date.now(), keys: j.keys || [] };
    return this.appleKeys.keys;
  }

  private async verifyAppleToken(dto: AppleLoginDto): Promise<OAuthProfile> {
    const token = String(dto.identityToken || '');
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Token de Apple inválido');
    let header: any;
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new UnauthorizedException('Token de Apple inválido'); }
    if (header.alg !== 'RS256' || !header.kid) throw new UnauthorizedException('Token de Apple inválido');

    let jwk = (await this.appleJwks()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await this.appleJwks(true)).find((k) => k.kid === header.kid);
    if (!jwk) throw new UnauthorizedException('Token de Apple inválido');

    // Firma RS256 verificada con la clave pública de Apple
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const firma = Buffer.from(parts[2], 'base64url');
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    if (!crypto.verify('RSA-SHA256', data, key, firma)) throw new UnauthorizedException('Token de Apple inválido');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.iss !== 'https://appleid.apple.com') throw new UnauthorizedException('Token de Apple: issuer inválido');
    const audiencias = String(this.config.get('APPLE_CLIENT_ID') || 'com.mediclick.app').split(',').map((x) => x.trim()).filter(Boolean);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.some((x: string) => audiencias.includes(x))) throw new UnauthorizedException('Token de Apple: audience inválido');
    if (!payload.exp || payload.exp * 1000 < Date.now()) throw new UnauthorizedException('Token de Apple expirado');

    // Solo se confía en el email que viene FIRMADO por Apple (nunca en el que manda la app)
    const verificado = payload.email_verified === true || payload.email_verified === 'true';
    const email = payload.email && verificado ? String(payload.email) : '';
    if (!email) throw new UnauthorizedException('Apple no compartió un email verificado. Ingresá con email y contraseña o con Google.');

    return {
      provider: 'apple',
      providerId: payload.sub,
      email,
      firstName: dto.fullName?.givenName,
      lastName: dto.fullName?.familyName,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // BUSCAR O CREAR DOCTOR (compartido Google/Apple)
  // ═══════════════════════════════════════════════════════════

  private async findOrCreateDoctor(profile: OAuthProfile) {
    // 1. Buscar por provider + providerId en oauth_accounts
    let oauthAccount = await this.db.queryOne(
      `SELECT doctor_id FROM oauth_accounts 
       WHERE provider = $1 AND provider_id = $2`,
      [profile.provider, profile.providerId],
    );

    let doctorId: string;
    let isNewUser = false;

    if (oauthAccount) {
      // Ya existe → login
      doctorId = oauthAccount.doctor_id;
      
      // Actualizar último login
      await this.db.query(
        `UPDATE oauth_accounts SET last_login_at = NOW() WHERE provider = $1 AND provider_id = $2`,
        [profile.provider, profile.providerId],
      );
    } else {
      // No existe → buscar por email o crear nuevo
      let doctor = await this.db.queryOne(
        `SELECT id FROM doctors WHERE email = $1`,
        [profile.email],
      );

      if (doctor) {
        // Doctor existe con ese email → vincular cuenta OAuth
        doctorId = doctor.id;
      } else {
        // Doctor nuevo → crear cuenta + org individual
        isNewUser = true;

        const result = await this.db.transaction(async (client) => {
          // Crear doctor (sin password, login solo por OAuth)
          const newDoctor = await client.query(
            `INSERT INTO doctors (
              email, password_hash, first_name, last_name, 
              medical_license, avatar_url, is_verified, email_verified_at
            ) VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
            RETURNING id, email, role`,
            [
              profile.email,
              'OAUTH_NO_PASSWORD',     // Marca especial: login solo por OAuth
              profile.firstName || 'Doctor',
              profile.lastName || '',
              'PENDING_' + crypto.randomBytes(6).toString('hex'),  // Matrícula pendiente
              profile.avatarUrl || null,
            ],
          );

          const docId = newDoctor.rows[0].id;

          // Crear organización individual
          const org = await client.query(
            `INSERT INTO organizations (name, type)
             VALUES ($1, 'individual')
             RETURNING id`,
            [`Dr. ${profile.firstName || ''} ${profile.lastName || ''}`.trim()],
          );

          // Vincular doctor como owner
          await client.query(
            `INSERT INTO organization_doctors (organization_id, doctor_id, role, is_owner)
             VALUES ($1, $2, 'owner', true)`,
            [org.rows[0].id, docId],
          );

          return { doctorId: docId };
        });

        doctorId = result.doctorId;
      }

      // Crear registro OAuth
      await this.db.query(
        `INSERT INTO oauth_accounts (doctor_id, provider, provider_id, email, avatar_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [doctorId, profile.provider, profile.providerId, profile.email, profile.avatarUrl],
      );
    }

    // 3. Obtener datos del doctor
    const doctor = await this.db.queryOne(
      `SELECT id, email, first_name, last_name, role, specialty, 
              avatar_url, medical_license, is_verified
       FROM doctors WHERE id = $1`,
      [doctorId],
    );

    // 4. Obtener organizaciones
    const organizations = await this.db.queryMany(
      `SELECT org_id, org_name, org_type, role, is_owner
       FROM v_doctor_orgs WHERE doctor_id = $1`,
      [doctorId],
    );

    // 5. Generar JWT tokens
    const payload = { sub: doctor.id, email: doctor.email, role: doctor.role, userType: 'doctor' as const };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: '7d',
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: '30d',
      }),
    ]);

    // Guardar refresh token (usando bcrypt para consistencia con auth.service)
    const bcryptLib = await import('bcrypt');
    const refreshHash = await bcryptLib.hash(refreshToken, 10);
    await this.db.query(
      'UPDATE doctors SET refresh_token_hash = $1, last_login_at = NOW() WHERE id = $2',
      [refreshHash, doctorId],
    );

    this.logger.log(`OAuth login: ${profile.provider} → ${profile.email} (${isNewUser ? 'NEW' : 'existing'})`);

    return {
      accessToken,
      refreshToken,
      userType: 'doctor' as const,
      user: doctor,
      doctor,
      organizations,
      isNewUser,
      needsLicense: doctor.medical_license?.startsWith('PENDING_') || false,
    };
  }
}
