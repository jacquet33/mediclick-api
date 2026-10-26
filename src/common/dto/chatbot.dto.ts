import {
  IsString, IsNotEmpty, IsOptional, IsUUID, IsArray,
  MaxLength,
} from 'class-validator';

/** POST /public/chatbot/:slug/ask */
export class ChatbotAskDto {
  @IsString()
  @IsNotEmpty({ message: 'El mensaje es obligatorio' })
  @MaxLength(1000, { message: 'Mensaje demasiado largo (máx 1000 caracteres)' })
  message: string;
}

/** POST /chatbot/config — upsert chatbot config */
export class UpsertChatbotConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  welcomeMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fallbackMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  accentColor?: string;
}

/** POST /chatbot/faqs */
export class AddFaqDto {
  @IsUUID('4')
  configId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question: string;

  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  answer: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}
