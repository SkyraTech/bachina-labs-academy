import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * DatabaseHealthService — wraps PrismaService.isHealthy() for the health module.
 *
 * Intentionally thin — all DB logic stays in PrismaService.
 * Does NOT expose connection strings, database names, or credentials.
 */
@Injectable()
export class DatabaseHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async isReachable(): Promise<boolean> {
    return this.prisma.isHealthy();
  }
}
