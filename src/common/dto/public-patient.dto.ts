import {
  IsString, IsNotEmpty, IsOptional, IsEmail,
  MaxLength, Matches, IsIn,
} from 'class-validator';

/**
 * DTO para el registro público de pacientes desde reservar.html.
 * Endpoint sin autenticación — validación estricta.
 */
export class PublicRegisterPatientDto {
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
  @MaxLength(20)
  dni?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato de fecha: YYYY-MM-DD' })
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @IsIn(['M', 'F', 'X', 'male', 'female', 'other'])
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  insuranceProvider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  insuranceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  insurancePlan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
