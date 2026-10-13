import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './modules/health/health.module';
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
 */
@Module({
  imports: [
    // ── Configuration ───────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Domain modules (added per phase) ───────────────────────────────
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
