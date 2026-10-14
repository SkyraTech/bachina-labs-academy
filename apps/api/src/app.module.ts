import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmailModule } from './modules/email/email.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import appConfig from './config/app.config';
import emailConfig from './config/email.config';
import jwtConfig from './config/jwt.config';

/**
 * Root application module.
 *
 * Domain modules will be imported here as they are implemented:
 *   AuthModule, UsersModule, AuthorsModule, ArticlesModule,
 *   CategoriesModule, TagsModule, SearchModule, MediaModule,
 *   CommentsModule, AnalyticsModule, NotificationsModule,
 *   SubscriptionsModule, EntitlementsModule, McpModule, AdminModule
 *
 * Each domain module lives under src/modules/<domain>/
 * following the Controller → Service → Repository → Prisma layering.
 *
 * DatabaseModule is @Global() — PrismaService is available everywhere
 * without importing DatabaseModule in individual feature modules.
 */
@Module({
  imports: [
    // ── Configuration ───────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, emailConfig, jwtConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Rate limiting (in-memory, no external dependency) ────────────────
    // Limit: 10 requests per 60 seconds per IP (global default).
    // Applied globally via APP_GUARD below.
    // Limitation: in-memory storage resets on process restart and does not
    // share state across horizontally-scaled instances. A distributed cache
    // (e.g. Redis) should be introduced if the API is load-balanced.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000, // 60 seconds window (in ms for @nestjs/throttler v6)
          limit: 10,   // max 10 requests per IP per window
        },
      ],
    }),

    // ── Database (global — provides PrismaService to all modules) ───────
    DatabaseModule,

    // ── Domain modules (added per phase) ───────────────────────────────
    HealthModule,
    UsersModule,   // Phase 2.2.1 — users table and domain foundation
    AuthModule,    // Phase 2.2.2 — email/password registration
    EmailModule,   // Phase 2.2.3 — transactional email (Mailpit/Resend)
    SessionsModule, // Phase 2.2.4A — session persistence foundation
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply ThrottlerGuard globally — covers all controllers and routes
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

