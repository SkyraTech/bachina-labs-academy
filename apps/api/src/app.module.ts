import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import appConfig from './config/app.config';

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
      load: [appConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Database (global — provides PrismaService to all modules) ───────
    DatabaseModule,

    // ── Domain modules (added per phase) ───────────────────────────────
    HealthModule,
    UsersModule, // Phase 2.2.1 — users table and domain foundation
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
