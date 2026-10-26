import {
  IsString, IsNotEmpty, IsOptional, IsEmail, IsBoolean,
  IsNumber, IsIn, MaxLength, Min, Max, Matches,
} from 'class-validator';

// ─── Public booking (paciente sin auth) ─────────────────

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MaxLength(100)
  lastName: string;

  @IsString()
  @IsNotEmpty({ message: 'El teléfono es obligatorio' })
  @MaxLength(30)
  phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  email?: string;

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

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato de fecha: YYYY-MM-DD' })
  requestedDate: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Formato de hora: HH:MM' })
  requestedStartTime: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Formato de hora: HH:MM' })
  requestedEndTime: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsIn(['transfer', 'cash'], { message: 'Método de pago: transfer o cash' })
  paymentMethod?: 'transfer' | 'cash';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;
}

// ─── Booking settings (lado médico) ─────────────────────

export class BookingSettingsDto {
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug inválido (solo minúsculas, números y guiones)' })
  publicSlug?: string;

  @IsOptional()
  @IsIn(['open', 'approval', 'deposit', 'deposit_approval'])
  bookingMode?: 'open' | 'approval' | 'deposit' | 'deposit_approval';

  @IsOptional()
  @IsBoolean()
  requiresDeposit?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  depositPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  consultationFee?: number;

  @IsOptional()
  @IsIn(['transfer', 'cash', 'both'])
  paymentMethods?: 'transfer' | 'cash' | 'both';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankAccountHolder?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankCbu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  bankAlias?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  paymentDeadlineMinutes?: number;

  @IsOptional()
  @IsBoolean()
  chargeOnNoShow?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  noShowFee?: number;

  @IsOptional()
  @IsBoolean()
  keepsDepositOnNoShow?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minHoursBeforeCancel?: number;

  @IsOptional()
  @IsBoolean()
  refundOnEarlyCancel?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  maxDaysInAdvance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minHoursInAdvance?: number;

  @IsOptional()
  @IsBoolean()
  allowNewPatients?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresInsuranceInfo?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsPrepaidPrescription?: boolean;

  @IsOptional()
  @IsBoolean()
  prescriptionRequiresPayment?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  welcomeMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cancellationPolicyText?: string;
}
