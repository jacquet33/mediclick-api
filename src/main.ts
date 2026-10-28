import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { json } from 'express';
import { SanitizeInterceptor } from './common/interceptors/sanitize.interceptor';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { Module, Controller, Get, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { MedicalRecordPdfService } from './modules/medical-records/medical-record-pdf.service';
import { ChatController } from './modules/chat/chat.controller';
import { ChatService } from './modules/chat/chat.service';
import { ScheduleController } from './modules/schedules/schedule.controller';
import { ScheduleService } from './modules/schedules/schedule.service';
import { BookingController, PublicBookingController } from './modules/booking/booking.controller';
import { BookingService } from './modules/booking/booking.service';
import { BookingPageController } from './modules/booking/page.controller';
import { DirectoryController } from './modules/booking/directory.controller';
import { PublicChatbotController, ChatbotConfigController } from './modules/chatbot/chatbot.controller';
import { ChatbotService } from './modules/chatbot/chatbot.service';
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
import { ProfileController } from './modules/profile/profile.controller';
import { ProfileService } from './modules/profile/profile.service';
import { VerificationController } from './modules/verification/verification.controller';
import { VerificationService } from './modules/verification/verification.service';
import { RefepsService } from './modules/verification/refeps.service';
import { PrescriptionSigningService } from './modules/prescriptions/prescription-signing.service';
import { DigitalSignatureService } from './modules/prescriptions/digital-signature.service';
import { DigitalSignatureController } from './modules/prescriptions/digital-signature.controller';
import { PharmacyService } from './modules/pharmacy/pharmacy.service';
import { PrivacyController } from './modules/privacy/privacy.controller';
import { FhirService } from './modules/prescriptions/fhir.service';
import { CentralRepoService } from './modules/prescriptions/central-repo.service';
import { PharmacyApiController, PharmacyAdminController } from './modules/pharmacy/pharmacy.controller';
import { AuditController } from './modules/audit/audit.controller';
import { AuditService } from './modules/audit/audit.service';
import { ConsentController } from './modules/consent/consent.controller';
import { ConsentService } from './modules/consent/consent.service';
import { OnboardingController } from './modules/onboarding/onboarding.controller';
import { OnboardingService } from './modules/onboarding/onboarding.service';
import { ReminderCronController } from './modules/reminders/reminder-cron.controller';
import { ReminderCronService } from './modules/reminders/reminder-cron.service';
import { WhatsappReminderService } from './modules/reminders/whatsapp-reminder.service';
import { DocumentsService } from './modules/documents/documents.service';
import { AiService } from './modules/ai/ai.service';
import { GrowthService } from './modules/growth/growth.service';
import { GrowthController } from './modules/growth/growth.controller';
import { AiController } from './modules/ai/ai.controller';
import { PatientDocumentsController, MyDocumentsController } from './modules/documents/documents.controller';
import { WhatsappReminderController } from './modules/reminders/whatsapp-reminder.controller';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { PaymentController } from './modules/payments/payment.controller';
import { MercadoPagoService } from './modules/payments/mercadopago.service';
import { EmailService } from './modules/email/email.service';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './common/guards/auth.guard';
import { ProGuard } from './common/guards/pro.guard';
import { RedisService } from './common/redis.service';
import { ThrottlerRedisStorage } from './common/throttler-redis.storage';
import helmet from 'helmet';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

import { Public } from './common/guards/auth.guard';
import { SkipThrottle } from './common/decorators/throttle.decorator';

@Public()
@SkipThrottle()
@Controller('api/v1')
class HealthController {
  constructor(private db: DatabaseService, private config: ConfigService) {}

  @Get('health')
  async health() {
    const dbOk = await this.db.isHealthy();
    const schema = dbOk
      ? await this.db.queryOne<{ v: string }>(`SELECT max(filename) AS v FROM schema_migrations`).catch(() => null)
      : null;
    return {
      status: dbOk ? 'ok' : 'degraded',
      service: 'mediclick-api',
      schema: schema?.v?.slice(0, 3) || null,
      version: '1.0.0',
      database: dbOk ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('public/config')
  publicConfig() {
    return {
      googleClientId: this.config.get('GOOGLE_CLIENT_ID_WEB') || this.config.get('GOOGLE_CLIENT_ID') || '',
      appleSignInEnabled: !!this.config.get('APPLE_CLIENT_ID'),
      // Link de la app para médicos (App Store). Variable IOS_APP_STORE_URL (vacío = "próximamente")
      iosAppUrl: this.config.get('IOS_APP_STORE_URL') || '',
      androidAppUrl: this.config.get('ANDROID_APP_URL') || '',
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({ global: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
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
    DirectoryController,
    PublicChatbotController,
    ChatbotConfigController,
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
    ProfileController,
    VerificationController,
    DigitalSignatureController,
    PharmacyApiController,
    PharmacyAdminController,
    PrivacyController,
    AuditController,
    ConsentController,
    OnboardingController,
    PatientDocumentsController, MyDocumentsController, AiController, GrowthController, WhatsappReminderController, ReminderCronController,
    DashboardController,
    PaymentController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    RedisService,
    ThrottlerRedisStorage,
    { provide: 'ThrottlerStorage', useExisting: ThrottlerRedisStorage },
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
    ChatbotService,
    MedicalRecordService,
    MedicalRecordPdfService,
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
    ProfileService,
    VerificationService,
    RefepsService,
    PrescriptionSigningService,
    DigitalSignatureService,
    PharmacyService,
    FhirService,
    CentralRepoService,
    AuditService,
    ConsentService,
    OnboardingService,
    ReminderCronService, WhatsappReminderService, DocumentsService, AiService, GrowthService,
    DashboardService,
    MercadoPagoService,
    EmailService,
    { provide: APP_GUARD, useClass: ProGuard },
  ],
})
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware, RequestLoggerMiddleware)
      .forRoutes('*');
  }
}

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
  // CORS: allow the app's own domain + localhost for dev
  const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  // Dominios propios: siempre permitidos (el nuevo de Rispy Health y el anterior, mientras dure la migración)
  if (allowedOrigins.length) {
    for (const o of ['https://tuconsultorio.rispy.io', 'https://medicos.rispy.io', 'https://mediclick.art3d-studio.com.ar']) {
      if (!allowedOrigins.includes(o)) allowedOrigins.push(o);
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: {
      origin: allowedOrigins.length
        ? (origin, callback) => {
            // Allow requests with no origin (mobile apps, server-to-server)
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) {
              return callback(null, true);
            }
            callback(new Error('CORS not allowed'));
          }
        : true, // fallback: allow all in dev if CORS_ORIGINS not set
      credentials: true,
    },
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/client'],
          // Las páginas públicas usan onclick="..." en los botones: Helmet los bloquea por defecto
          // (script-src-attr 'none') y el login del portal no hacía nada.
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
          frameSrc: ["'self'", 'https://accounts.google.com/gsi/'],
        },
      },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new SanitizeInterceptor());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,           // strip unknown properties
    forbidNonWhitelisted: true, // throw on unknown properties
    transform: true,           // auto-transform payloads to DTO instances
    transformOptions: { enableImplicitConversion: true },
    stopAtFirstError: false,
  }));
  // Páginas públicas: /portal y /portal.html sirven lo mismo (los mails enlazan sin .html)
  // Dominio anterior (mediclick.art3d-studio.com.ar): las páginas redirigen al nuevo.
  // La API sigue respondiendo ahí para las versiones de la app que todavía lo usan.
  app.use((req, res, next) => {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
    const url = String(req.originalUrl || req.url || '/');
    if (host === 'medicos.rispy.io' && (url === '/' || url.startsWith('/?'))) {
      req.url = '/medicos.html' + url.slice(1);
    }
    if (host === 'mediclick.art3d-studio.com.ar' && (req.method === 'GET' || req.method === 'HEAD') && !url.startsWith('/api/')) {
      const destino = url.replace(/^\/portal\.html/, '/portal');
      return res.redirect(301, 'https://tuconsultorio.rispy.io' + destino);
    }
    next();
  });
  app.useStaticAssets(join(__dirname, '..', 'public'), { extensions: ['html'] });
  
  // Auto-convert snake_case → camelCase on all incoming JSON bodies.
  // El JSON se parsea acá mismo: Nest agrega su parser recién en init(), así que sin esto
  // req.body todavía no existía y la conversión nunca corría (las apps mandan snake_case
  // y los DTO rechazaban esos campos, o se guardaban vacíos).
  // Los webhooks de terceros (Mercado Pago, Apple, Google) se dejan tal cual llegan.
  app.use(json({ limit: '10mb' }));
  app.use((req: any, _res: any, next: any) => {
    if (req.body && typeof req.body === 'object' && !String(req.originalUrl || req.url).includes('/webhooks/')) {
      req.body = snakeToCamel(req.body);
    }
    next();
  });
  // Graceful shutdown — let in-flight requests finish before exiting
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`TuConsultorioOnline API v1.0.0 running on port ${port}`);
  console.log(`Health: http://localhost:${port}/api/v1/health`);
}
bootstrap();
