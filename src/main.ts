import { NestFactory } from '@nestjs/core';
import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// ─── Health Controller ──────────────────────────────────────
@Controller('api/v1')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'mediclick-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── App Module ─────────────────────────────────────────────
@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [HealthController],
})
class AppModule {}

// ─── Bootstrap ──────────────────────────────────────────────
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`MediClick API running on port ${port}`);
}
bootstrap();
