import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import type { VerificationTokenRecord } from '../types/email-verification.types.js';

/**
 * EmailVerificationTokenRepository — data access for verification tokens.
 *
 * Responsibilities:
 *   - Translate token lifecycle intent into parameterized Prisma queries.
 *   - Serialize token issuance per user via a row lock on `users`, so the
 *     cooldown cannot be raced.
 *   - Expose only VerificationTokenRecord — NEVER the tokenHash, which is the
 *     closest thing this table holds to a credential.
 *   - Log identifiers only. Never log the raw token, its hash, or an email.
 *
 * Rules:
 *   - Domain policy (what "consume" means, what the caller should tell a user)
 *     belongs in EmailVerificationService. The cooldown DURATION is passed in
 *     rather than read here, so this class holds no policy of its own.
 *   - Do not bypass the global PrismaService.
 *
 * Concurrency model
 * ─────────────────
 *   Issuance serializes on the owning users row with SELECT ... FOR UPDATE.
 *   That lock is the primary guarantee: it makes "check the latest issuance
 *   time" and "insert a replacement" atomic with respect to every other
 *   issuance for the same account, which is what actually enforces the cooldown.
 *
 *   The hand-maintained partial unique index,
 *   email_verification_tokens_user_active_key ON (user_id) WHERE consumed_at IS NULL,
 *   is retained as defence in depth. It still bounds the table to one active
 *   token per user if application logic is ever bypassed, and any INSERT that
 *   races past the lock surfaces as P2002 — mapped here to a typed conflict so
 *   a raw Prisma error never escapes.
 */
/** Everything the issuance transaction needs. The clock is injected, not read. */
export interface IssueTokenInput {
  /** Account UUID — the row that will be locked. */
  readonly userId: string;
  /** SHA-256 hex digest of the raw token (64 chars). */
  readonly tokenHash: string;
  /** Absolute expiry for the new token. */
  readonly expiresAt: Date;
  /**
   * The clock to judge the cooldown against. Passed in rather than read here
   * so callers own the clock and tests never need to sleep.
   */
  readonly now: Date;
  /** Cooldown length in seconds. Policy lives in the service; this holds none. */
  readonly cooldownSeconds: number;
}

/** Result of a successful issuance. */
export interface IssueTokenResult {
  readonly record: VerificationTokenRecord;
  /** True when outstanding tokens existed and were invalidated by this call. */
  readonly supersededPrevious: boolean;
}

@Injectable()
export class EmailVerificationTokenRepository {
  private readonly logger = new Logger(EmailVerificationTokenRepository.name);

  /**
   * Select object exposing lifecycle metadata only.
   * tokenHash is deliberately absent.
   */
  private readonly safeSelect = {
    id: true,
    userId: true,
    expiresAt: true,
    consumedAt: true,
    createdAt: true,
  } as const;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues a token for a user under a per-user row lock, enforcing the cooldown.
   *
   * Why a row lock
   * ──────────────
   * The partial unique index bounds the table to one UNCONSUMED token per user,
   * but it cannot enforce the cooldown: once a token is consumed the user is
   * unconstrained again, so a client could verify and immediately reissue. The
   * fix is to serialize every issuance for a given user on that user's row in
   * `users` via SELECT ... FOR UPDATE. The lock is held until commit, so
   * concurrent registrations and resends for the same account execute one at a
   * time rather than racing.
   *
   * The sequence, all inside one transaction:
   *   1. Lock the users row. This is the serialization point.
   *   2. Read the LATEST token of ANY status — consumed tokens included, since
   *      they carry the most recent issuance timestamp.
   *   3. Reject when now - latest.createdAt < cooldownSeconds.
   *   4. Delete outstanding (unconsumed) tokens, invalidating them.
   *   5. Insert exactly one replacement.
   *   6. Commit, releasing the lock.
   *
   * Consumed tokens count toward the cooldown — that is the specific gap the
   * previous design had, and it is why step 2 must not filter on consumedAt.
   *
   * The partial unique index remains as defence in depth: an INSERT that raced
   * past the lock still fails, and that failure is mapped to the same cooldown
   * outcome so no account state is disclosed.
   *
   * @param input - userId, tokenHash, absolute expiry, and the clock/cooldown
   *   to judge against. `now` is passed in rather than read here so callers
   *   control the clock and tests need not sleep.
   * @returns the created record plus whether an outstanding token was replaced
   * @throws CooldownError when the last issuance is inside the cooldown window
   * @throws UserNotFoundError when the account no longer exists
   */
  async issueToken(input: IssueTokenInput): Promise<IssueTokenResult> {
    const { userId, tokenHash, expiresAt, now, cooldownSeconds } = input;
    this.logger.debug(`issueToken: userId=${userId}`);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // ── 1. Serialize on the owning user row ────────────────────────────
          // FOR UPDATE holds a transaction-scoped lock on this one users row.
          // Every other issuance for the same user blocks here until we commit,
          // so the cooldown check below cannot be raced.
          const lockedRows = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE
          `;

          if (lockedRows.length === 0) {
            // Account was deleted between the caller's lookup and this
            // transaction. Nothing to issue for.
            throw new UserNotFoundError(userId);
          }

          // ── 2. Latest issuance, regardless of status ───────────────────────
          // Deliberately NOT filtered on consumedAt: a consumed token is still
          // the most recent issuance and must start the cooldown clock.
          const latest = await tx.emailVerificationToken.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          });

          // ── 3. Enforce the cooldown ────────────────────────────────────────
          if (latest !== null) {
            const elapsedMs = now.getTime() - latest.createdAt.getTime();
            if (elapsedMs < cooldownSeconds * 1000) {
              throw new CooldownError(userId, cooldownSeconds * 1000 - elapsedMs);
            }
          }

          // ── 4. Invalidate outstanding tokens ───────────────────────────────
          // Only unconsumed rows are removed. Consumed rows stay as the cooldown
          // history that step 2 depends on.
          const deleted = await tx.emailVerificationToken.deleteMany({
            where: { userId, consumedAt: null },
          });

          // ── 5. Insert exactly one replacement ──────────────────────────────
          const created = await tx.emailVerificationToken.create({
            data: { userId, tokenHash, expiresAt },
            select: this.safeSelect,
          });

          return {
            record: created,
            supersededPrevious: deleted.count > 0,
          };
        },
        // The lock in step 1 can block behind a concurrent transaction, so give
        // it more headroom than Prisma's 5s default. This is still bounded well
        // below anything a client can hold open, and an exhausted timeout rolls
        // the whole issuance back rather than leaving a partial state.
        { maxWait: 10_000, timeout: 15_000 },
      );
    } catch (error: unknown) {
      // Typed domain signals pass through untouched.
      if (isCooldownError(error) || isUserNotFound(error)) {
        throw error;
      }

      // Backstop: the partial unique index rejected the INSERT, meaning
      // something bypassed the lock. Report it as a cooldown conflict — the
      // caller's response is identical either way, and distinguishing them
      // would leak that an account exists.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn(
          `issueToken: unique-constraint conflict after lock [userId=${userId}]`,
        );
        throw new ActiveTokenConflictError(userId);
      }

      throw error;
    }
  }

  /**
   * Finds an unconsumed token by its hash.
   *
   * The caller has already hashed the presented raw token, so this lookup goes
   * through the unique token_hash index and never handles plaintext.
   *
   * @param tokenHash - SHA-256 digest of the presented token
   * @returns the record, or null when no token matches
   */
  async findActiveByHash(
    tokenHash: string,
  ): Promise<VerificationTokenRecord | null> {
    this.logger.debug('findActiveByHash: [hash redacted]');

    return await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: this.safeSelect,
    });
  }

  /**
   * Atomically consumes an unconsumed token AND stamps users.emailVerifiedAt.
   *
   * Why one transaction
   * ───────────────────
   * The invariant "a token is consumed if and only if the account becomes
   * verified" spans two tables. Splitting it into two statements would leave a
   * window where the token is burned but the account is not verified (user must
   * request a new link for an account that is already half-verified), or where
   * the account is verified but the token is still live (replayable). Running
   * both inside one interactive transaction makes the pair all-or-nothing.
   *
   * Why compare-and-swap, not read-then-write
   * ─────────────────────────────────────────
   * Both writes carry a `null` guard:
   *   - token:   WHERE id = ? AND consumed_at IS NULL
   *   - user:    WHERE id = ? AND email_verified_at IS NULL
   * Each is a conditional UPDATE, so the database decides the winner. Two
   * concurrent verifications of the same token cannot both observe
   * count === 1 on the token write; the loser aborts before touching users,
   * and is reported as already-used. This is what makes a consumed token
   * incapable of ever succeeding again — there is no read-modify-write race.
   *
   * The user write is deliberately guarded rather than unconditional so that a
   * replay can never move emailVerifiedAt forward. If that timestamp is later
   * used for audit or entitlement effective-dating, it will always reflect the
   * FIRST successful verification.
   *
   * Lock ordering
   * ─────────────
   * The owning users row is locked FIRST, exactly as issueToken() does. Both
   * paths therefore acquire locks in the same order (users row → token rows),
   * which is what rules out the deadlock this combination could otherwise
   * produce: issuance holds the users row then deletes token rows, while
   * consumption would otherwise burn a token row and then reach for the users
   * row. With the users row taken up front, one of them simply waits.
   *
   * @param tokenId - UUID of the token row
   * @param userId - UUID of the owning account
   * @param consumedAt - timestamp recorded for both writes
   * @returns { consumed: boolean; newlyVerified: boolean }
   *          consumed=false        → another caller already used this token
   *          newlyVerified=false   → account was already verified beforehand
   */
  async consumeTokenAndVerifyUser(
    tokenId: string,
    userId: string,
    consumedAt: Date,
  ): Promise<{ consumed: boolean; newlyVerified: boolean }> {
    this.logger.debug(`consumeTokenAndVerifyUser: tokenId=${tokenId}`);

    return await this.prisma.$transaction(
      async (tx) => {
        // Step 0 — lock the owning account so lock order matches issueToken().
        // Disabled and suspended accounts cannot verify.
        const lockedRows = await tx.$queryRaw<{ id: string; status: string }[]>`
          SELECT "id", "status"::text AS "status" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE
        `;

        if (lockedRows.length === 0 || lockedRows[0].status !== 'ACTIVE') {
          // Account gone or not active (e.g. SUSPENDED or DISABLED); cannot verify.
          return { consumed: false, newlyVerified: false };
        }

        // Step 1 — burn the token. Conditional, so only one caller can win.
        const tokenUpdate = await tx.emailVerificationToken.updateMany({
          where: { id: tokenId, consumedAt: null },
          data: { consumedAt },
        });

        if (tokenUpdate.count === 0) {
          // Lost the race (or already consumed). Abort before touching users.
          return { consumed: false, newlyVerified: false };
        }

        // Step 2 — stamp the account. Conditional so a replay cannot move the
        // timestamp, and so we can report whether this call did the verifying.
        const userUpdate = await tx.user.updateMany({
          where: { id: userId, emailVerifiedAt: null, status: 'ACTIVE' },
          data: { emailVerifiedAt: consumedAt },
        });

        return { consumed: true, newlyVerified: userUpdate.count === 1 };
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
  }
}

/**
 * Raised when an INSERT violates the partial unique index that permits at most
 * one unconsumed token per user.
 *
 * This is a concurrency signal, not a fault: another request issued a token
 * first. EmailVerificationService maps it to the cooldown outcome so the racing
 * caller receives the same generic response as any other resend.
 */
export class ActiveTokenConflictError extends Error {
  constructor(userId: string) {
    super('An active verification token was concurrently created for this user.');
    this.name = 'ActiveTokenConflictError';
    this.userId = userId;
  }

  readonly userId: string;
}

/**
 * Raised when a new token is requested inside the cooldown window measured
 * from the most recent issuance, regardless of that token's status.
 *
 * Thrown from inside the locked issuance transaction, so the caller cannot
 * distinguish "you just asked" from "someone else just asked" — which is
 * exactly the point, since that distinction would leak account state.
 */
export class CooldownError extends Error {
  constructor(userId: string, remainingMs: number) {
    super('Token issuance is inside the cooldown window.');
    this.name = 'CooldownError';
    this.userId = userId;
    this.remainingMs = remainingMs;
  }

  readonly userId: string;
  /** Milliseconds left before the next issuance would be permitted. */
  readonly remainingMs: number;
}

/**
 * Raised when the owning account row cannot be located during issuance —
 * the user was deleted between the caller's lookup and the transaction.
 *
 * The lock query in step 1 returns no rows, so there is nothing to serialize
 * against and nothing to issue for.
 */
export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super('The account for this token no longer exists.');
    this.name = 'UserNotFoundError';
    this.userId = userId;
  }

  readonly userId: string;
}

/** Narrowing helper: true when an error is the active-token race. */
export function isActiveTokenConflict(
  error: unknown,
): error is ActiveTokenConflictError {
  return error instanceof ActiveTokenConflictError;
}

/** Narrowing helper: true when an error is the cooldown rejection. */
export function isCooldownError(error: unknown): error is CooldownError {
  return error instanceof CooldownError;
}

/** Narrowing helper: true when an error is the missing-owner rejection. */
export function isUserNotFound(error: unknown): error is UserNotFoundError {
  return error instanceof UserNotFoundError;
}
