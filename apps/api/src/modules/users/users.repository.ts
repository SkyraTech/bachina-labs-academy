import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { UserLookupResult } from './types/index.js';

/**
 * UsersRepository — data access layer for the users domain.
 *
 * Responsibilities:
 *   - Translate domain query intent into parameterized Prisma queries.
 *   - Strip the password hash from every returned record.
 *   - Log only non-sensitive context (IDs, not email addresses or hashes).
 *
 * Rules:
 *   - NEVER return passwordHash through any method on this class.
 *   - NEVER log passwordHash, raw email input, or any credential material.
 *   - Use parameterized Prisma queries — never string-interpolate user input.
 *   - Domain logic (e.g. "is this user allowed to do X") belongs in UsersService,
 *     not here.
 *   - Do not bypass the global PrismaService with a new PrismaClient instance.
 *
 * Methods provided here are intentionally minimal — only the lookups required
 * for the upcoming authentication workflow. Create/update/delete methods will
 * be added in the authentication implementation step.
 */
@Injectable()
export class UsersRepository {
  private readonly logger = new Logger(UsersRepository.name);

  /**
   * Prisma select object that explicitly omits passwordHash.
   * Applied consistently across all public-facing queries.
   */
  private readonly safeSelect = {
    id: true,
    email: true,
    role: true,
    status: true,
    emailVerifiedAt: true,
    createdAt: true,
    updatedAt: true,
    // passwordHash is deliberately absent — never include it here
  } as const;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds a user by their UUID primary key.
   *
   * @param id — UUID string (not validated here; caller is responsible)
   * @returns SafeUser if found, null if no matching record exists
   */
  async findById(id: string): Promise<UserLookupResult> {
    this.logger.debug(`findById: ${id}`);

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.safeSelect,
    });

    return user;
  }

  /**
   * Finds a user by their email address.
   *
   * Important: email input MUST be normalized to lowercase by the caller
   * before invoking this method. This repository does not perform normalization
   * because it is a persistence concern, not a data-access concern.
   *
   * The lookup uses the standard unique index (users_email_key).
   * Because application code always normalizes email to lowercase at the
   * input boundary, this aligns with the LOWER(email) uniqueness guarantee
   * enforced by the users_email_lower_key database index.
   *
   * @param email — already-normalized (lowercase, trimmed) email address
   * @returns SafeUser if found, null if no matching record exists
   */
  async findByEmail(email: string): Promise<UserLookupResult> {
    // Log only a redacted hint — never log the raw email value
    this.logger.debug('findByEmail: [redacted]');

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: this.safeSelect,
    });

    return user;
  }
}
