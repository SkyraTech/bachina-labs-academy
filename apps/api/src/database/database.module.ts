import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * DatabaseModule — global NestJS module for database access.
 *
 * Decorated with @Global() so PrismaService is available throughout
 * the application without importing DatabaseModule in each feature module.
 *
 * Domain modules should:
 *   - Inject PrismaService directly (no further module imports needed)
 *   - NEVER instantiate PrismaClient themselves
 *
 * Example injection in a domain service:
 *   constructor(private readonly prisma: PrismaService) {}
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
