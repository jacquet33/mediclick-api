import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database/database.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { OAuthController } from './modules/auth/oauth.controller';
import { OAuthService } from './modules/auth/oauth.service';
import { OrganizationController, InvitationController } from './modules/organizations/organization.controller';
import { OrganizationService } from './modules/organizations/organization.service';
import { PatientController } from './modules/patients/patient.controller';
import { PatientService } from './modules/patients/patient.service';
import { AppointmentController } from './modules/appointments/appointment.controller';
import { AppointmentService } from './modules/appointments/appointment.service';
import { PrescriptionController } from './modules/prescriptions/prescription.controller';
import { PrescriptionService } from './modules/prescriptions/prescription.service';
import { MedicalRecordController } from './modules/medical-records/medical-record.controller';
import { MedicalRecordService } from './modules/medical-records/medical-record.service';
import { ChatController } from './modules/chat/chat.controller';
import { ChatService } from './modules/chat/chat.service';
import { ScheduleController } from './modules/schedules/schedule.controller';
import { ScheduleService } from './modules/schedules/schedule.service';
import { BookingController, PublicBookingController } from './modules/booking/booking.controller';
import { BookingService } from './modules/booking/booking.service';
import { BookingPageController } from './modules/booking/page.controller';
import { HubController } from './modules/hub/hub.controller';
import { HubService } from './modules/hub/hub.service';
import { GenericRestAdapter } from './modules/hub/adapters/generic-rest.adapter';
import { ManualAdapter } from './modules/hub/adapters/manual.adapter';
import { JwtModule } from '@nestjs/jwt';

@Controller('api/v1')
class HealthController {
  constructor(private db: DatabaseService) {}

  @Get('health')
  async health() {
    const dbOk = await this.db.isHealthy();
    return {
      status: dbOk ? 'ok' : 'degraded',
      service: 'mediclick-api',
      version: '1.0.0',
      database: dbOk ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({ global: true }),
  ],
  controllers: [
    HealthController,
    AuthController,
    OAuthController,
    OrganizationController,
    InvitationController,
    PatientController,
    AppointmentController,
    PrescriptionController,
    MedicalRecordController,
    ChatController,
    ScheduleController,
    BookingController,
    PublicBookingController,
    BookingPageController,
    HubController,
  ],
  providers: [
    DatabaseService,
    AuthService,
    OAuthService,
    OrganizationService,
    PatientService,
    AppointmentService,
    PrescriptionService,
    MedicalRecordService,
    ChatService,
    ScheduleService,
    BookingService,
    HubService,
    GenericRestAdapter,
    ManualAdapter,
  ],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  app.useStaticAssets(join(__dirname, '..', 'public'));
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`MediClick API v1.0.0 running on port ${port}`);
  console.log(`Health: http://localhost:${port}/api/v1/health`);
}
bootstrap();
