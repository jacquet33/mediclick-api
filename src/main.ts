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
import { PatientHistoryService } from './modules/patients/patient-history.service';
import { AppointmentController } from './modules/appointments/appointment.controller';
import { AppointmentService } from './modules/appointments/appointment.service';
import { PrescriptionController } from './modules/prescriptions/prescription.controller';
import { PrescriptionService } from './modules/prescriptions/prescription.service';
import { PrescriptionPdfService } from './modules/prescriptions/prescription-pdf.service';
import { PrescriptionTemplateController } from './modules/prescriptions/prescription-template.controller';
import { PrescriptionTemplateService } from './modules/prescriptions/prescription-template.service';
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
import { InsurerController } from './modules/insurers/insurer.controller';
import { InsurerService } from './modules/insurers/insurer.service';
import { NomenclatorController } from './modules/nomenclators/nomenclator.controller';
import { NomenclatorService } from './modules/nomenclators/nomenclator.service';
import { BillingController } from './modules/billing/billing.controller';
import { BillingService } from './modules/billing/billing.service';
import { ReminderSettingsController } from './modules/reminders/reminder-settings.controller';
import { ReminderSettingsService } from './modules/reminders/reminder-settings.service';
import { RolesController, OrgMembersController } from './modules/roles/roles.controller';
import { RolesService } from './modules/roles/roles.service';
import { WaitlistController, PublicWaitlistController } from './modules/waitlist/waitlist.controller';
import { WaitlistService } from './modules/waitlist/waitlist.service';
import { PushController } from './modules/push/push.controller';
import { PushNotificationService } from './modules/push/push.service';
import { SubscriptionController } from './modules/subscriptions/subscription.controller';
import { SubscriptionService } from './modules/subscriptions/subscription.service';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './common/guards/auth.guard';
import { ProGuard } from './common/guards/pro.guard';

import { Public } from './common/guards/auth.guard';

@Public()
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
    PrescriptionTemplateController,
    MedicalRecordController,
    ChatController,
    ScheduleController,
    BookingController,
    PublicBookingController,
    BookingPageController,
    HubController,
    InsurerController,
    NomenclatorController,
    BillingController,
    ReminderSettingsController,
    RolesController,
    OrgMembersController,
    WaitlistController,
    PublicWaitlistController,
    PushController,
    SubscriptionController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    DatabaseService,
    AuthService,
    OAuthService,
    OrganizationService,
    PatientService,
    PatientHistoryService,
    AppointmentService,
    PrescriptionService,
    PrescriptionPdfService,
    PrescriptionTemplateService,
    MedicalRecordService,
    ChatService,
    ScheduleService,
    BookingService,
    HubService,
    GenericRestAdapter,
    ManualAdapter,
    InsurerService,
    NomenclatorService,
    BillingService,
    ReminderSettingsService,
    RolesService,
    WaitlistService,
    PushNotificationService,
    SubscriptionService,
    { provide: APP_GUARD, useClass: ProGuard },
  ],
})
class AppModule {}

// Convert snake_case body keys to camelCase (iOS sends snake_case, NestJS DTOs expect camelCase)
function snakeToCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.keys(obj).reduce((acc: any, key: string) => {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      acc[camel] = snakeToCamel(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  app.useStaticAssets(join(__dirname, '..', 'public'));
  
  // Auto-convert snake_case → camelCase on all incoming JSON bodies
  app.use((req: any, _res: any, next: any) => {
    if (req.body && typeof req.body === 'object') {
      req.body = snakeToCamel(req.body);
    }
    next();
  });
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`MediClick API v1.0.0 running on port ${port}`);
  console.log(`Health: http://localhost:${port}/api/v1/health`);
}
bootstrap();
