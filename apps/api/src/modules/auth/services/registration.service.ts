import {
  Injectable,
  ConflictException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditActorFactory } from '../../audit/types/audit-event.types.js';
import { UsersService } from '../../users/users.service.js';
import { UsersRepository } from '../../users/users.repository.js';
import { PasswordHashingService } from './password-hashing.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import type { RegisterRequestDto } from '../dto/register-request.dto.js';
import type { SafeUser } from '../../users/types/index.js';

/**
 * RegistrationService — orchestrates the email/password registration workflow.
 *
 * Workflow:
 *   1. Receive an already-validated and email-normalized RegisterRequestDto.
 *   2. Perform a preliminary duplicate check for a meaningful conflict response.
 *   3. Hash the password using Argon2id via PasswordHashingService.
 *   4. Persist the user record and audit log atomically via Prisma transaction.
 *   5. Issue the verification email — AFTER the transaction is committed, and without
 *      letting a delivery failure undo the account.
 *   6. Return SafeUser — passwordHash never leaves this service boundary.
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
    private readonly emailVerificationService: EmailVerificationService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Registers a new user account.
   *
   * @param dto — validated and email-normalized registration request
   * @returns SafeUser — the created user record without passwordHash
   * @throws ConflictException if the email already exists (exact or case-insensitive match)
   * @throws InternalServerErrorException for unexpected hashing or persistence failures
   *
   * Email verification is issued AFTER the user row is committed, and its
   * failure is deliberately non-fatal — see the call site below.
   */
  async register(dto: RegisterRequestDto): Promise<SafeUser> {
    const { email, password } = dto;

    // ── Preliminary duplicate check ──────────────────────────────────────────
    // Gives a fast, meaningful response for the common case.
    // Not relied upon for uniqueness enforcement — see concurrency note above.
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      this.logger.warn(
        'Registration conflict: email already exists [action=auth.registration, outcome=failure]',
      );
      throw new ConflictException(
        'An account with this email address already exists.',
      );
    }

    // ── Hash the password ────────────────────────────────────────────────────
    // Argon2id with OWASP-aligned parameters. Never log the result.
    const passwordHash = await this.passwordHashingService.hash(password);

    // ── Persist the user and mandatory transactional audit log ───────────────
    // Atomically creates the user record and audit record in a single transaction.
    // Verification issuance is intentionally outside it — see the comment at that call site.
    let user: SafeUser;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await this.usersRepository.createUser(
          {
            email,
            passwordHash,
          },
          tx,
        );

        await this.auditService.recordTransactional(tx, {
          action: 'auth.user.registered',
          actor: AuditActorFactory.fromRegistrationTarget({
            id: created.id,
            role: created.role as 'AUTHOR' | 'ADMIN',
          }),
          resourceType: 'USER',
          resourceId: null, // Privacy Option A
          outcome: 'SUCCESS',
          metadata: {
            role: created.role as 'AUTHOR' | 'ADMIN',
            registrationMethod: 'EMAIL_PASSWORD',
          },
        });

        return created;
      });
    } catch (error: unknown) {
      // Handle concurrent duplicate registration — both exact and case-insensitive
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn(
          'Concurrent duplicate registration blocked by DB constraint [action=auth.registration, outcome=failure]',
        );
        throw new ConflictException(
          'An account with this email address already exists.',
        );
      }

      // Any other persistence failure — log without exposing internals
      this.logger.error('Unexpected error during user creation [action=auth.registration, outcome=failure]', {
        errorCode:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : 'UNKNOWN',
      });
      throw new InternalServerErrorException(
        'An error occurred while processing your request',
      );
    }

    this.logger.log(
      `Registration successful for user: ${user.id} [action=auth.registration, outcome=success]`,
    );

    // ── Issue the verification email ───────────────────────────────────────
    // Deliberately AFTER persistence has succeeded and OUTSIDE its try/catch.
    //
    // Outside the try/catch: that block maps persistence failures to 500 and
    // would destroy a successfully created account over a transient SMTP
    // blip. The account row is committed at this point, so a delivery failure
    // must not roll anything back — the user recovers via
    // POST /resend-verification.
    //
    // Awaited rather than fire-and-forget: an unawaited promise would surface
    // as an unhandled rejection after the response is sent and would hide the
    // failure from request logs entirely. Awaiting keeps ordering
    // deterministic and testable.
    //
    // Wrapped in its own catch as defence in depth. issueVerificationEmail()
    // already swallows transport and issuance failures internally, so this
    // should be unreachable — but registration must not hinge on that staying
    // true across future refactors. A delivery failure must NEVER convert a
    // committed account into a 500.
    try {
      await this.emailVerificationService.issueVerificationEmail(user);
    } catch (error: unknown) {
      this.logger.warn(
        `Verification email issuance threw unexpectedly; account preserved [userId=${user.id}]`,
        { reason: error instanceof Error ? error.name : 'UNKNOWN' },
      );
    }

    return user;
  }
}
