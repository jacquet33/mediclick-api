import {
  IsEmail, IsString, IsNotEmpty, MinLength, MaxLength,
  IsOptional, IsUUID, Matches, IsIn,
} from 'class-validator';

// ─── Login ───────────────────────────────────────────────

export class LoginDto {
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty({ message: 'El email es obligatorio' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password: string;
}

// ─── Register doctor ────────────────────────────────────

export class RegisterDto {
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  @MaxLength(128)
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MaxLength(100)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @IsNotEmpty({ message: 'La matrícula es obligatoria' })
  @MaxLength(30)
  medicalLicense: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  specialty?: string;
}

// ─── Register patient ───────────────────────────────────

export class RegisterPatientDto {
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  @MaxLength(128)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  dni?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato de fecha: YYYY-MM-DD' })
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  insuranceProvider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  insuranceNumber?: string;

  @IsOptional()
  @IsUUID('4', { message: 'organizationId debe ser UUID válido' })
  organizationId?: string;
}

// ─── Register staff ─────────────────────────────────────

export class RegisterStaffDto {
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsUUID('4')
  organizationId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  roleCode: string;
}

// ─── Refresh token ──────────────────────────────────────

export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  doctorId?: string; // backward compat

  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

// ─── Change password ────────────────────────────────────

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword: string;
}

// ─── OAuth ──────────────────────────────────────────────

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @IsOptional()
  @IsIn(['patient', 'doctor'])
  intent?: 'patient' | 'doctor';

  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class AppleLoginDto {
  @IsOptional()
  @IsIn(['patient', 'doctor'])
  intent?: 'patient' | 'doctor';

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsString()
  @IsNotEmpty()
  identityToken: string;

  @IsString()
  @IsNotEmpty()
  authorizationCode: string;

  @IsOptional()
  fullName?: { givenName?: string; familyName?: string };

  @IsOptional()
  @IsEmail()
  email?: string;
}
