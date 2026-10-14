import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseHealthService } from './database-health.service';

/**
 * HealthModule — exposes two distinct health endpoints:
 *
 *   GET /health          — Application liveness (always responds if process is alive)
 *   GET /health/database — Database readiness (separate from app liveness)
 *
 * Separating liveness from readiness ensures a database outage does NOT
 * falsely report the application process as dead.
 *
 * PrismaService is injected via the global DatabaseModule — no explicit import needed.
 */
@Module({
  controllers: [HealthController],
  providers: [DatabaseHealthService],
})
export class HealthModule {}
