import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

interface HealthResponse {
  status: 'ok';
  timestamp: string;
  uptime: number;
}

/**
 * Health check controller.
 * Route: GET /health (excluded from /api/v1 prefix in main.ts)
 *
 * Returns a simple liveness response. No database check at Step 1.
 * Database connectivity check will be added in Phase 2 once Prisma is migrated.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Application health check' })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2026-10-13T09:00:00.000Z' },
        uptime: { type: 'number', example: 42.5 },
      },
    },
  })
  check(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
