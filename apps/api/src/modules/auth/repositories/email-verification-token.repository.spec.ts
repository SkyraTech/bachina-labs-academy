import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  EmailVerificationTokenRepository,
  ActiveTokenConflictError,
  CooldownError,
  UserNotFoundError,
  isActiveTokenConflict,
  isCooldownError,
  isUserNotFound,
} from './email-verification-token.repository.js';

/**
 * Unit tests for the issuance transaction — the cooldown and concurrency core.
 *
 * Prisma is fully mocked: these tests assert the ORDER and CONDITIONS of the
 * statements the transaction issues, not PostgreSQL's behaviour. What they pin
 * down is that the code asks the database the right questions in the right
 * sequence, which is the part unit tests can actually prove:
 *
 *   1.  The users row is locked with FOR UPDATE before anything else — the
 *       serialization point that makes the cooldown non-racy.
 *   2.  The latest issuance is read WITHOUT a consumedAt filter, so a CONSUMED
 *       token still enforces the cooldown. This is the specific defect the
 *       row-lock redesign fixes.
 *   3.  The cooldown comparison uses the injected clock, not Date.now().
 *   4.  Outstanding tokens are invalidated; consumed ones are retained as the
 *       cooldown history that (2) depends on.
 *   5.  A missing account, a cooldown breach and an insert conflict each surface
 *       as a TYPED error — never a raw Prisma error, and never a message that
 *       could leak account state.
 *
 * The database-level proof — that FOR UPDATE actually blocks a second
 * connection, that two simultaneous requests serialize, that a consumed token
 * really does reject — belongs to the post-migration integration suite, since
 * those claims need a real lock manager to observe.
 */

import { AuditService } from '../../audit/audit.service.js';

const USER_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const TOKEN_HASH = 'f'.repeat(64);
const EXPIRES_AT = new Date('2026-10-15T09:00:00.000Z');
const NOW = new Date('2026-10-14T09:00:00.000Z');
const COOLDOWN_SECONDS = 60;

type Tx = ReturnType<typeof makeTx>;

/** The transaction client handed to the callback. */
function makeTx() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: USER_ID, status: 'ACTIVE' }]),
    emailVerificationToken: {
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({
        id: 'e1f2a3b4-0000-4000-8000-000000000005',
        userId: USER_ID,
        expiresAt: EXPIRES_AT,
        consumedAt: null,
        createdAt: NOW,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

/** Builds a PrismaService double whose $transaction runs the callback. */
function prismaWith(tx: Tx) {
  return {
    $transaction: vi.fn(
      async (fn: (client: Tx) => Promise<unknown>, _options?: unknown) =>
        await fn(tx),
    ),
  } as unknown as PrismaService & { $transaction: ReturnType<typeof vi.fn> };
}

/** The raw SQL text passed to $queryRaw, with values elided. */
function lockSql(tx: Tx): string {
  const call = tx.$queryRaw.mock.calls[0] as
    | [TemplateStringsArray, ...unknown[]]
    | undefined;
  return call ? call[0].join('?') : '';
}

/** A PrismaClientKnownRequestError carrying the requested code. */
function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mock prisma failure', {
    code,
    clientVersion: 'test',
  });
}

describe('EmailVerificationTokenRepository', () => {
  let tx: Tx;
  let repository: EmailVerificationTokenRepository;
  let auditServiceMock: {
    recordTransactional: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    tx = makeTx();
    auditServiceMock = {
      recordTransactional: vi.fn().mockResolvedValue({
        id: 'mock-audit-id',
        action: 'auth.email.verified',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationTokenRepository,
        { provide: PrismaService, useValue: prismaWith(tx) },
        { provide: AuditService, useValue: auditServiceMock },
      ],
    }).compile();

    repository = module.get<EmailVerificationTokenRepository>(
      EmailVerificationTokenRepository,
    );
  });

  const issue = (overrides: Partial<Parameters<typeof repository.issueToken>[0]> = {}) =>
    repository.issueToken({
      userId: USER_ID,
      tokenHash: TOKEN_HASH,
      expiresAt: EXPIRES_AT,
      now: NOW,
      cooldownSeconds: COOLDOWN_SECONDS,
      ...overrides,
    });

  // ── Serialization ─────────────────────────────────────────────────────────

  describe('row locking', () => {
    // Everything else in this transaction is only race-free because the lock
    // is taken first. If it moves after the cooldown read, the check becomes
    // advisory and two requests can both pass it.
    it('locks the owning users row BEFORE reading any token', async () => {
      await issue();

      expect(lockSql(tx)).toMatch(/FROM\s+"users"/i);
      expect(lockSql(tx)).toMatch(/FOR UPDATE/i);
      // Lock is statement #1 — ahead of the cooldown read and the insert.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.emailVerificationToken.findFirst.mock.invocationCallOrder[0]!,
      );
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.emailVerificationToken.create.mock.invocationCallOrder[0]!,
      );
    });

    it('binds the userId as a parameter rather than interpolating SQL', async () => {
      await issue();

      const call = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(call.slice(1)).toEqual([USER_ID]);
      // The raw UUID must never appear inside the SQL string itself.
      expect(call[0].join('')).not.toContain(USER_ID);
    });

    it('rejects when the account row is gone', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(issue()).rejects.toThrow(UserNotFoundError);
      // Nothing may be written for a user we could not lock.
      expect(tx.emailVerificationToken.create).not.toHaveBeenCalled();
      expect(tx.emailVerificationToken.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ── The cooldown, and the defect it fixes ─────────────────────────────────

  describe('cooldown enforcement', () => {
    it('issues freely when no token has ever existed', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue(null);

      const result = await issue();

      expect(result.record).toBeDefined();
      expect(result.supersededPrevious).toBe(false);
    });

    it('issues when the latest token is older than the cooldown', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 61_000),
      });

      await expect(issue()).resolves.toBeDefined();
    });

    it('rejects when the latest token is inside the cooldown', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 5_000),
      });

      await expect(issue()).rejects.toThrow(CooldownError);
      expect(tx.emailVerificationToken.create).not.toHaveBeenCalled();
    });

    it('reports the remaining time so the caller can log it', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 15_000),
      });

      const error = await issue().catch((e: unknown) => e);

      expect(isCooldownError(error)).toBe(true);
      expect((error as CooldownError).remainingMs).toBe(45_000);
      expect((error as CooldownError).userId).toBe(USER_ID);
    });

    // THE BUG THIS REDESIGN FIXES. Previously the read was filtered to
    // unconsumed tokens, so verifying an account emptied the "recent issuance"
    // record and the very next request passed the cooldown check. A consumed
    // token is still the most recent issuance and must keep starting the clock.
    it('still enforces the cooldown when the latest token is CONSUMED', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 10_000),
        consumedAt: new Date(NOW.getTime() - 9_000),
      });

      await expect(issue()).rejects.toThrow(CooldownError);
      expect(tx.emailVerificationToken.create).not.toHaveBeenCalled();
    });

    // Guard against the regression reintroducing a consumedAt filter. Asserting
    // the query shape is what keeps the fix from silently un-fixing itself.
    it('reads the latest token WITHOUT filtering on consumed status', async () => {
      await issue();

      const args = tx.emailVerificationToken.findFirst.mock.calls[0]?.[0] as {
        where: Record<string, unknown>;
        orderBy: unknown;
      };
      expect(args.where).toEqual({ userId: USER_ID });
      expect(args.where).not.toHaveProperty('consumedAt');
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    // Proves the cooldown is judged against the caller's clock, not Date.now().
    // `now` is set 30s BEFORE the token's creation. Under the injected clock
    // elapsed time is negative, so issuance must be rejected. Had the code read
    // the system clock instead, this token would look ~6 years old and issuance
    // would be allowed — so this assertion fails loudly on that regression.
    it('judges the cooldown against the INJECTED clock, not the system clock', async () => {
      const injectedNow = new Date('2020-01-01T00:00:00.000Z');
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date('2020-01-01T00:00:30.000Z'),
      });

      await expect(issue({ now: injectedNow })).rejects.toThrow(CooldownError);
    });

    it('treats a token issued exactly at the boundary as inside the window', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 59_999),
      });

      await expect(issue()).rejects.toThrow(CooldownError);
    });

    it('permits issuance exactly at the boundary', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 60_000),
      });

      await expect(issue()).resolves.toBeDefined();
    });
  });

  // ── Invalidation and retention ─────────────────────────────────────────────

  describe('token invalidation', () => {
    it('invalidates outstanding tokens when reissuing', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 120_000),
      });
      tx.emailVerificationToken.deleteMany.mockResolvedValue({ count: 1 });

      const result = await issue();

      expect(tx.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, consumedAt: null },
      });
      expect(result.supersededPrevious).toBe(true);
    });

    it('reports no supersession when nothing outstanding existed', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue(null);
      tx.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });

      const result = await issue();

      expect(result.supersededPrevious).toBe(false);
    });

    // Consumed rows are the cooldown history. Deleting them would reopen the
    // exact bypass this design closes.
    it('never deletes CONSUMED tokens', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 120_000),
      });

      await issue();

      const args = tx.emailVerificationToken.deleteMany.mock.calls[0]?.[0] as {
        where: Record<string, unknown>;
      };
      expect(args.where.consumedAt).toBeNull();
    });

    // Exactly one active token per issuance, with the hash — never the raw
    // token — reaching storage.
    it('creates exactly one token carrying only the hash', async () => {
      await issue();

      expect(tx.emailVerificationToken.create).toHaveBeenCalledTimes(1);
      expect(tx.emailVerificationToken.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          tokenHash: TOKEN_HASH,
          expiresAt: EXPIRES_AT,
        },
        select: expect.any(Object),
      });
    });

    // The transaction must be atomic: the delete and the insert run inside ONE
    // $transaction callback, so an interruption can never leave a user with
    // neither token or two. The order also matters — clearing the old state
    // before creating the new one.
    it('performs the delete and the insert inside one transaction callback', async () => {
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 120_000),
      });

      await issue();

      const prisma = repository as unknown as { prisma: { $transaction: ReturnType<typeof vi.fn> } };
      expect(prisma.prisma.$transaction).toHaveBeenCalledTimes(1);

      // Delete strictly precedes insert, and both ran on the callback's client.
      expect(
        tx.emailVerificationToken.deleteMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        tx.emailVerificationToken.create.mock.invocationCallOrder[0]!,
      );
    });

    // The lock can block behind a concurrent transaction, so the transaction
    // must have explicit headroom beyond Prisma's 5s default. Without it a
    // legitimately waiting request would abort mid-issuance.
    it('extends the transaction timeout so the lock can wait', async () => {
      await issue();

      const prisma = repository as unknown as { prisma: { $transaction: ReturnType<typeof vi.fn> } };
      const options = prisma.prisma.$transaction.mock.calls[0]?.[1] as {
        timeout: number;
        maxWait: number;
      };

      expect(options.timeout).toBeGreaterThan(5_000);
      expect(options.maxWait).toBeGreaterThan(0);
    });
  });

  // ── Error translation ─────────────────────────────────────────────────────

  describe('error translation', () => {
    // A raw Prisma error escaping here would surface as a 500 and could echo
    // constraint details. The partial unique index conflict must be reported as
    // the same generic cooldown signal as any other cooldown rejection.
    it('maps a unique-constraint violation to ActiveTokenConflictError', async () => {
      tx.emailVerificationToken.create.mockRejectedValue(prismaError('P2002'));

      const error = await issue().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ActiveTokenConflictError);
      expect(isActiveTokenConflict(error)).toBe(true);
      expect(error).not.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('does NOT translate unrelated Prisma failures', async () => {
      tx.emailVerificationToken.create.mockRejectedValue(prismaError('P2025'));

      const error = await issue().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(isActiveTokenConflict(error)).toBe(false);
      expect(isCooldownError(error)).toBe(false);
    });

    it('passes the cooldown signal through the catch untouched', async () => {
      // If the catch-all rewrapped it, the service could no longer tell a
      // cooldown from a transport failure and would log the wrong thing.
      tx.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(NOW.getTime() - 1_000),
      });

      const error = await issue().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CooldownError);
      expect(isCooldownError(error)).toBe(true);
    });

    it('passes the missing-user signal through the catch untouched', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      const error = await issue().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UserNotFoundError);
      expect(isUserNotFound(error)).toBe(true);
    });

    it('never leaks the token hash in an error message', async () => {
      tx.emailVerificationToken.create.mockRejectedValue(prismaError('P2002'));

      const error = await issue().catch((e: unknown) => e);

      expect(String((error as Error).message)).not.toContain(TOKEN_HASH);
    });

    // Type guards must be false for ordinary errors, or the service would
    // misclassify a genuine fault as a cooldown and hide a real outage.
    it('type guards reject unrelated errors', () => {
      expect(isCooldownError(new Error('boom'))).toBe(false);
      expect(isUserNotFound(new Error('boom'))).toBe(false);
      expect(isActiveTokenConflict(new Error('boom'))).toBe(false);
      expect(isCooldownError(undefined)).toBe(false);
      expect(isUserNotFound(null)).toBe(false);
    });
  });

  // ── consumeTokenAndVerifyUser ───────────────────────────────────────────────

  describe('consumeTokenAndVerifyUser', () => {
    it('consumes token, updates user, and records auth.email.verified atomically in tx', async () => {
      const result = await repository.consumeTokenAndVerifyUser(
        'e1f2a3b4-0000-4000-8000-000000000005',
        USER_ID,
        NOW,
      );

      expect(result).toEqual({ consumed: true, newlyVerified: true });
      expect(tx.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'e1f2a3b4-0000-4000-8000-000000000005', consumedAt: null },
        data: { consumedAt: NOW },
      });
      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: USER_ID, emailVerifiedAt: null, status: 'ACTIVE' },
        data: { emailVerifiedAt: NOW },
      });
      expect(auditServiceMock.recordTransactional).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: 'auth.email.verified',
          outcome: 'SUCCESS',
          resourceType: 'USER',
          resourceId: null,
          metadata: {
            tokenCategory: 'EMAIL_VERIFICATION',
            verificationMethod: 'LINK',
          },
        }),
      );
    });

    it('does not record audit log if token was already consumed (token update count = 0)', async () => {
      tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.consumeTokenAndVerifyUser(
        'e1f2a3b4-0000-4000-8000-000000000005',
        USER_ID,
        NOW,
      );

      expect(result).toEqual({ consumed: false, newlyVerified: false });
      expect(tx.user.updateMany).not.toHaveBeenCalled();
      expect(auditServiceMock.recordTransactional).not.toHaveBeenCalled();
    });

    it('rolls back transaction if audit recording fails', async () => {
      auditServiceMock.recordTransactional.mockRejectedValue(
        new Error('Audit write rejected'),
      );

      await expect(
        repository.consumeTokenAndVerifyUser(
          'e1f2a3b4-0000-4000-8000-000000000005',
          USER_ID,
          NOW,
        ),
      ).rejects.toThrow('Audit write rejected');
    });
  });
});
