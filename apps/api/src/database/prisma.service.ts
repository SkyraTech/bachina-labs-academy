import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — centralised Prisma Client for the application.
 *
 * Rules:
 *  - This is the ONLY place PrismaClient is instantiated.
 *  - Never instantiate PrismaClient directly in domain modules or controllers.
 *  - Always inject PrismaService via NestJS DI.
 *  - DatabaseModule exports this service globally — no per-module imports needed.
 *
 * Lifecycle:
 *  - OnModuleInit  → $connect()   (called once on app bootstrap)
 *  - OnModuleDestroy → $disconnect() (called on graceful shutdown)
 *
 * Generated client:           @prisma/client (node_modules)
 * Schema location:            prisma/schema.prisma
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Connecting to database...');
    await this.$connect();
    this.logger.log('Database connection established.');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting from database...');
    await this.$disconnect();
  }

  /**
   * Performs a raw `SELECT 1` to verify database connectivity.
   * Used by the database health check — does not expose connection details.
   * Returns true if reachable, false otherwise.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
