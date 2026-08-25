import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';

// ─── DTOs ───────────────────────────────────────────────────

export interface GoogleLoginDto {
  idToken: string;          // Token que devuelve Google Sign-In SDK
}

export interface AppleLoginDto {
  identityToken: string;    // JWT que devuelve Apple Sign-In
  authorizationCode: string;
  fullName?: {
    givenName?: string;
    familyName?: string;
  };
  email?: string;           // Apple solo lo manda la primera vez
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
  ) {}

  // ═══════════════════════════════════════════════════════════
  // GOOGLE SIGN-IN
  // ═══════════════════════════════════════════════════════════

  async loginWithGoogle(dto: GoogleLoginDto) {
    // 1. Verificar el idToken con Google
    const profile = await this.verifyGoogleToken(dto.idToken);

    // 2. Buscar o crear doctor
    return this.findOrCreateDoctor(profile);
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

    // 2. Buscar o crear doctor
    return this.findOrCreateDoctor(profile);
  }

  private async verifyAppleToken(dto: AppleLoginDto): Promise<OAuthProfile> {
    // Decodificar el JWT de Apple (sin verificar firma por ahora,
    // en producción usar las Apple public keys de https://appleid.apple.com/auth/keys)
    const parts = dto.identityToken.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Token de Apple inválido');
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );

    // Verificar issuer y audience
    if (payload.iss !== 'https://appleid.apple.com') {
      throw new UnauthorizedException('Token de Apple: issuer inválido');
    }

    const appleClientId = this.config.get('APPLE_CLIENT_ID');
    if (appleClientId && payload.aud !== appleClientId) {
      throw new UnauthorizedException('Token de Apple: audience inválido');
    }

    // Verificar expiración
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      throw new UnauthorizedException('Token de Apple expirado');
    }

    // Apple solo envía email y nombre la PRIMERA vez
    // Después hay que buscarlo por providerId
    const email = payload.email || dto.email;

    return {
      provider: 'apple',
      providerId: payload.sub,
      email: email || '',
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
    const payload = { sub: doctor.id, email: doctor.email, role: doctor.role };
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

    // Guardar refresh token
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.db.query(
      'UPDATE doctors SET refresh_token_hash = $1, last_login_at = NOW() WHERE id = $2',
      [refreshHash, doctorId],
    );

    this.logger.log(`OAuth login: ${profile.provider} → ${profile.email} (${isNewUser ? 'NEW' : 'existing'})`);

    return {
      accessToken,
      refreshToken,
      doctor,
      organizations,
      isNewUser,
      needsLicense: doctor.medical_license?.startsWith('PENDING_') || false,
    };
  }
}
