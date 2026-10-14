import {
  Injectable,
  ConflictException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from '../../users/users.service.js';
import { UsersRepository } from '../../users/users.repository.js';
import { PasswordHashingService } from './password-hashing.service.js';
import type { RegisterRequestDto } from '../dto/register-request.dto.js';
import type { SafeUser } from '../../users/types/index.js';

/**
 * RegistrationService — orchestrates the email/password registration workflow.
 *
 * Workflow:
 *   1. Receive an already-validated and email-normalized RegisterRequestDto.
 *   2. Perform a preliminary duplicate check for a meaningful conflict response.
 *   3. Hash the password using Argon2id via PasswordHashingService.
 *   4. Persist the user record via UsersRepository (email + hash only).
 *   5. Return SafeUser — passwordHash never leaves this service boundary.
 *
 * Concurrency safety:
 *   The preliminary existence check (step 2) is NOT sufficient on its own.
 *   Two concurrent registrations with the same email can both pass the check
 *   and race toward the INSERT. The database unique constraints
 *   (users_email_key and users_email_lower_key) are the authoritative guard.
 *   PrismaClientKnownRequestError with code P2002 is caught and converted to
 *   ConflictException in both the preliminary path and the concurrent path.
 *
 * Account enumeration:
 *   ConflictException always returns a consistent message:
 *   "An account with this email address already exists."
 *   This confirms a conflict exists, which is a deliberate design choice:
 *   - Email registration inherently discloses email existence (the user typed it).
 *   - Hiding the conflict would create usability issues with no meaningful security gain.
 *   - Future login responses must NOT distinguish "wrong email" from "wrong password".
 *
 * Security rules:
 *   - NEVER log plaintext passwords.
 *   - NEVER log password hashes.
 *   - NEVER return passwordHash in any result.
 *   - Do not assign roles, statuses or verification timestamps here — those are
 *     enforced by Prisma model defaults and database column defaults.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly usersRepository: UsersRepository,
    private readonly passwordHashingService: PasswordHashingService,
  ) {}

  /**
   * Registers a new user account.
   *
   * @param dto — validated and email-normalized registration request
   * @returns SafeUser — the created user record without passwordHash
   * @throws ConflictException if the email already exists (exact or case-insensitive match)
   * @throws InternalServerErrorException for unexpected hashing or persistence failures
   */
  async register(dto: RegisterRequestDto): Promise<SafeUser> {
    const { email, password } = dto;

    // ── Preliminary duplicate check ──────────────────────────────────────────
    // Gives a fast, meaningful response for the common case.
    // Not relied upon for uniqueness enforcement — see concurrency note above.
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      this.logger.warn('Registration attempted for existing email [redacted]');
      throw new ConflictException(
        'An account with this email address already exists.',
      );
    }

    // ── Hash the password ────────────────────────────────────────────────────
    // Argon2id with OWASP-aligned parameters. Never log the result.
    const passwordHash = await this.passwordHashingService.hash(password);

    // ── Persist the user ─────────────────────────────────────────────────────
    try {
      const user = await this.usersRepository.createUser({
        email,
        passwordHash,
      });

      this.logger.log(`Registration successful for user: ${user.id}`);
      return user;
    } catch (error: unknown) {
      // Handle concurrent duplicate registration — both exact and case-insensitive
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn(
          'Concurrent duplicate registration blocked by DB constraint',
        );
        throw new ConflictException(
          'An account with this email address already exists.',
        );
      }

      // Any other persistence failure — log without exposing internals
      this.logger.error('Unexpected error during user creation', {
        errorCode:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : 'UNKNOWN',
      });
      throw new InternalServerErrorException(
        'An error occurred while processing your request',
      );
    }
  }
}
