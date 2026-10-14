import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DatabaseHealthService } from './database-health.service';
import { Public } from '../auth/decorators/public.decorator';

interface LivenessResponse {
  status: 'ok';
  timestamp: string;
  uptime: number;
}

interface ReadinessResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  database: 'connected' | 'unreachable';
}

/**
 * HealthController — application liveness and database readiness endpoints.
 *
 * Routes are excluded from the /api/v1 global prefix (configured in main.ts).
 *
 * GET /health          — Liveness: always responds if the process is alive.
 *                        Does NOT check database. Use for process health probes.
 *
 * GET /health/database — Readiness: checks database connectivity.
 *                        Returns 200 when DB is reachable, 503 when not.
 *                        Does NOT expose connection strings or credentials.
 *
 * Separation rationale:
 *   A database outage should not make the application appear to be dead.
 *   Liveness and readiness probes serve different monitoring purposes.
 */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly dbHealth: DatabaseHealthService) {}

  // ── GET /health — Application liveness ──────────────────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Application liveness check' })
  @ApiResponse({
    status: 200,
    description: 'Application process is alive',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2026-10-13T09:00:00.000Z' },
        uptime: { type: 'number', example: 42.5 },
      },
    },
  })
  check(): LivenessResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  // ── GET /health/database — Database readiness ────────────────────────────

  @Get('database')
  @ApiOperation({ summary: 'Database readiness check' })
  @ApiResponse({
    status: 200,
    description: 'Database is reachable',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2026-10-13T09:00:00.000Z' },
        database: { type: 'string', example: 'connected' },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Database is unreachable',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'degraded' },
        timestamp: { type: 'string', example: '2026-10-13T09:00:00.000Z' },
        database: { type: 'string', example: 'unreachable' },
      },
    },
  })
  async databaseCheck(): Promise<ReadinessResponse> {
    const isReachable = await this.dbHealth.isReachable();
    if (!isReachable) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        database: 'unreachable',
      });
    }
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
    };
  }
}
