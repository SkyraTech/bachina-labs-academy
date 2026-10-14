import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersRepository } from './users.repository.js';

/**
 * UsersModule — NestJS module for the users domain.
 *
 * Provides:
 *   UsersService    — application-layer user lookups and email normalization.
 *   UsersRepository — Prisma-backed persistence queries for user records.
 *
 * Exports:
 *   UsersService is exported so other modules (e.g. AuthModule) can inject
 *   it without importing UsersModule repeatedly — they will import this
 *   module and receive UsersService through it.
 *
 * Database access:
 *   PrismaService is injected via the global DatabaseModule.
 *   No additional DatabaseModule import is needed here.
 *
 * No controller is registered at this phase:
 *   There is no public Users CRUD API at this step.
 *   User-facing endpoints will be introduced alongside the authentication
 *   workflow in the next approved phase.
 */
@Module({
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
