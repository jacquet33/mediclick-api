import {
  IsString, IsNotEmpty, IsOptional, IsBoolean, IsUUID,
  MaxLength, Matches,
} from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID('4', { message: 'patientId debe ser UUID válido' })
  patientId: string;

  @IsUUID('4', { message: 'doctorId debe ser UUID válido' })
  doctorId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato de fecha: YYYY-MM-DD' })
  date: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Formato de hora: HH:MM' })
  startTime: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Formato de hora: HH:MM' })
  endTime: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  isFirstVisit?: boolean;

  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  roomNumber?: string;

  @IsOptional()
  @IsBoolean()
  forceCreate?: boolean;
}

export class UpdateAppointmentStatusDto {
  @IsString()
  @IsNotEmpty()
  status: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelReason?: string;
}
