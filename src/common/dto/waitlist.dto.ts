import {
  IsString, IsNotEmpty, IsOptional, IsEmail,
  MaxLength, Matches,
} from 'class-validator';

/** POST /public/waitlist/:slug — público sin auth */
export class PublicWaitlistDto {
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

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato de fecha: YYYY-MM-DD' })
  desiredDate: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Formato de hora: HH:MM' })
  preferredStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Formato de hora: HH:MM' })
  preferredEndTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** POST /waitlist/:id/book */
export class BookWaitlistDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Formato de hora: HH:MM' })
  startTime: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Formato de hora: HH:MM' })
  endTime: string;
}
