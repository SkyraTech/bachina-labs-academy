import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * HealthModule exposes GET /health — excluded from /api/v1 prefix.
 * No authentication required. Used for readiness/liveness probes.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
