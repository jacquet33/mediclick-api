import {
  IsString, IsNotEmpty, IsOptional, IsIn, IsUUID, IsInt, Min, Max,
  MaxLength,
} from 'class-validator';

/** POST /payments/subscribe */
export class SubscribePlanDto {
  @IsString()
  @IsIn(['pro', 'centro'])
  plan: string;
}

/** POST /subscriptions/admin/grant */
export class AdminGrantDto {
  @IsUUID('4')
  doctorId: string;

  @IsInt()
  @Min(1)
  @Max(120)
  months: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** POST /billing/batches/:id/submit */
export class SubmitBatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  batchNumber?: string;
}

/** POST /booking/status/:token/payment — público */
export class UploadPaymentProofDto {
  @IsString()
  @IsNotEmpty()
  proofUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}

/** POST /booking/status/:token/cancel — público */
export class CancelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** POST /auth/logout */
export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}
