import {
  IsString, IsOptional, IsNotEmpty,
  MaxLength,
} from 'class-validator';

/** PUT /profile */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(6)
  titlePrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400000)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  specialty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  medicalLicense?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  medicalLicenseProvince?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;
}

/** PUT /profile/signature */
export class UpdateSignatureDto {
  @IsString()
  @IsNotEmpty({ message: 'La imagen de firma es obligatoria' })
  image: string;
}

