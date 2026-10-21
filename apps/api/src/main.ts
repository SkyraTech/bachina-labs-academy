import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { StructuredLoggerService } from './common/observability/structured-logger.service';

async function bootstrap(): Promise<void> {
  const structuredLogger = new StructuredLoggerService();

  const app = await NestFactory.create(AppModule, {
    logger: structuredLogger,
    bufferLogs: true,
  });

  app.useLogger(structuredLogger);
  const logger = new Logger('Bootstrap');

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const allowedOrigins = configService
    .get<string>('CORS_ALLOWED_ORIGINS', 'http://localhost:4200')
    .split(',')
    .map((o) => o.trim());

  // ── Reverse proxy trust ───────────────────────────────────────────────
  const trustProxy = configService.get<boolean | number | string | string[]>(
    'app.trustProxy',
    false,
  );
  if (trustProxy !== false) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', trustProxy);
    logger.log(`Reverse proxy trust configured: ${JSON.stringify(trustProxy)}`);
  } else {
    logger.log('Reverse proxy trust: disabled (direct connection mode)');
  }

  // ── Security headers & Cookie parser ──────────────────────────────────
  app.use(helmet());
  app.use(cookieParser());

  // ── CORS ──────────────────────────────────────────────────────────────
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global API prefix ─────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1', {
    exclude: ['/health'], // health check at root level
  });

  // ── Global validation ─────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // ── Swagger / OpenAPI ─────────────────────────────────────────────────
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Bachina Labs Academy API')
      .setDescription('REST API for Bachina Labs Academy — powered by Skyra Tech')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    logger.log(`Swagger UI available at: http://localhost:${port}/api/docs`);
  }

  // ── Start ─────────────────────────────────────────────────────────────
  await app.listen(port);
  logger.log(`API running on: http://localhost:${port}/api/v1`);
  logger.log(`Environment: ${nodeEnv}`);
}

bootstrap().catch((err: unknown) => {
  const structuredLogger = new StructuredLoggerService();
  structuredLogger.fatal('Fatal startup error', err);
  process.exit(1);
});
