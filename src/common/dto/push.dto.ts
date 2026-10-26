import {
  IsString, IsNotEmpty, IsOptional, IsIn,
  MaxLength,
} from 'class-validator';

/** POST /push/register */
export class RegisterPushDto {
  @IsString()
  @IsIn(['doctor', 'patient', 'staff'])
  userType: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token: string;

  @IsString()
  @IsIn(['ios', 'android', 'web'])
  platform: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  osVersion?: string;
}

/** DELETE /push/unregister */
export class UnregisterPushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token: string;
}

/** POST /push/test */
export class TestPushDto {
  @IsString()
  @IsIn(['doctor', 'patient', 'staff'])
  userType: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  body?: string;
}
