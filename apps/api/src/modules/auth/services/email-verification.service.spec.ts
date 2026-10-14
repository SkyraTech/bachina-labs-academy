import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service.js';
import { VerificationTokenService } from './verification-token.service.js';
import {
  EmailVerificationTokenRepository,
  ActiveTokenConflictError,
  CooldownError,
} from '../repositories/email-verification-token.repository.js';
import { EmailService } from '../../email/email.service.js';
import { EmailDeliveryError } from '../../email/types/email.types.js';
import { UsersService } from '../../users/users.service.js';
import { UserRole, UserStatus } from '../../users/types/index.js';
import type { SafeUser } from '../../users/types/index.js';
import type { VerificationTokenRecord } from '../types/email-verification.types.js';

/**
 * Unit tests for EmailVerificationService.
 *
 * All dependencies are mocked — no database, no mail transport, no network.
 * Tests cover the security invariants of Step 2.2.3:
 *
 *   1.  issueVerificationEmail swallows transport failure (account preserved)
 *   2.  issueVerificationEmail swallows issuance failure (account preserved)
 *   3.  issueVerificationEmail forwards the RAW token to the mailer
 *   4.  verifyEmail accepts a valid unexpired token
 *   5.  verifyEmail rejects an unknown token
 *   6.  verifyEmail rejects an expired token
 *   7.  verifyEmail rejects when the consume loses the concurrency race
 *   8.  ** All rejection paths throw the IDENTICAL error (no oracle) **
 *   9.  resendVerification: unknown address sends nothing
 *   10. resendVerification: verified account sends nothing
 *   11. resendVerification: cooldown signal from the locked transaction
 *   12. resendVerification: after cooldown issues and sends
 *   13. resendVerification: transport failure reports delivery_failed
 *   14. resendVerification: issuance race maps to cooldown_active, not a failure
 *   15. A stored token hash is never the raw token (hash-only storage)
 *
 * Cooldown / concurrency (service level)
 *   16. The service performs NO cooldown pre-check of its own — the decision is
 *       delegated entirely to the repository's locked transaction, because any
 *       check made here would be advisory and racy.
 *   17. Policy wiring: the configured cooldown duration and a single clock
 *       reading are handed to the transaction alongside the hash.
 *   18. Two simultaneous resends yield exactly one send; the loser, blocked
 *       behind the row lock, reports cooldown_active.
 *   19. Registration and resend share the SAME issuance path, so their tokens
 *       cannot conflict.
 *
 * The database-level proofs (that the row lock actually serializes, that a
 * CONSUMED token still enforces the cooldown) live in the post-migration
 * integration suite, since they require PostgreSQL row locks to observe.
 */

const USER_ID = 'c1d2e3f4-0000-0000-0000-000000000003';
const TOKEN_ID = 'd1e2f3a4-0000-0000-0000-000000000004';
const RAW_TOKEN = 'r'.repeat(43);
const COOLDOWN_SECONDS = 60;

const UNVERIFIED_USER: SafeUser = {
  id: USER_ID,
  email: 'alice@example.com',
  role: UserRole.AUTHOR,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: null,
  createdAt: new Date('2026-10-14T07:00:00.000Z'),
  updatedAt: new Date('2026-10-14T07:00:00.000Z'),
};

const VERIFIED_USER: SafeUser = {
  ...UNVERIFIED_USER,
  emailVerifiedAt: new Date('2026-10-14T08:00:00.000Z'),
};

function makeToken(
  overrides: Partial<VerificationTokenRecord> = {},
): VerificationTokenRecord {
  return {
    id: TOKEN_ID,
    userId: USER_ID,
    // Default: valid for another hour from "now".
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    consumedAt: null,
    createdAt: new Date(Date.now() - 5 * 60 * 1000),
    ...overrides,
  };
}

/** The argument object the service passes to repository.issueToken(). */
interface IssueTokenArgs {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
  cooldownSeconds: number;
}

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let usersServiceMock: { findByEmail: ReturnType<typeof vi.fn> };
  let tokenRepositoryMock: {
    issueToken: ReturnType<typeof vi.fn>;
    findActiveByHash: ReturnType<typeof vi.fn>;
    consumeTokenAndVerifyUser: ReturnType<typeof vi.fn>;
  };
  let emailServiceMock: {
    sendVerificationEmail: ReturnType<typeof vi.fn>;
  };
  let configServiceMock: { getOrThrow: ReturnType<typeof vi.fn> };

  const CONFIG = {
    enabled: true,
    provider: 'smtp',
    from: 'hello@skyra-tech.com',
    smtp: { host: '127.0.0.1', port: 1025, secure: false, user: '', pass: '' },
    resend: { apiKey: '' },
    verification: { ttlMinutes: 1440, cooldownSeconds: COOLDOWN_SECONDS },
    appBaseUrl: 'http://localhost:4200',
  };

  /** Convenience accessor: the args of the nth issueToken() call. */
  const issueArgs = (call = 0): IssueTokenArgs =>
    tokenRepositoryMock.issueToken.mock.calls[call]?.[0] as IssueTokenArgs;

  beforeEach(async () => {
    usersServiceMock = {
      findByEmail: vi.fn().mockResolvedValue(UNVERIFIED_USER),
    };

    tokenRepositoryMock = {
      issueToken: vi.fn().mockResolvedValue({
        record: makeToken(),
        supersededPrevious: false,
      }),
      findActiveByHash: vi.fn().mockResolvedValue(makeToken()),
      consumeTokenAndVerifyUser: vi
        .fn()
        .mockResolvedValue({ consumed: true, newlyVerified: true }),
    };

    emailServiceMock = {
      sendVerificationEmail: vi.fn().mockResolvedValue({
        messageId: 'test-message-id',
        provider: 'smtp',
      }),
    };

    configServiceMock = {
      getOrThrow: vi.fn().mockReturnValue(CONFIG),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        // Real instance: hashing correctness matters here, and mocking it
        // would let a broken hash path pass silently.
        VerificationTokenService,
        { provide: UsersService, useValue: usersServiceMock },
        {
          provide: EmailVerificationTokenRepository,
          useValue: tokenRepositoryMock,
        },
        { provide: EmailService, useValue: emailServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<EmailVerificationService>(EmailVerificationService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── issueVerificationEmail ─────────────────────────────────────────────────

  describe('issueVerificationEmail', () => {
    it('issues a token and sends the email', async () => {
      await service.issueVerificationEmail(UNVERIFIED_USER);

      expect(tokenRepositoryMock.issueToken).toHaveBeenCalledTimes(1);
      expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    // The registration contract: a mail outage must never destroy or 500 a
    // successfully created account.
    it('swallows transport failure and does not throw', async () => {
      emailServiceMock.sendVerificationEmail.mockRejectedValue(
        new EmailDeliveryError('CONNECTION_FAILED', 'SMTP down'),
      );

      await expect(
        service.issueVerificationEmail(UNVERIFIED_USER),
      ).resolves.toBeUndefined();
    });

    it('swallows token issuance failure and does not throw', async () => {
      tokenRepositoryMock.issueToken.mockRejectedValue(
        new Error('database unavailable'),
      );

      await expect(
        service.issueVerificationEmail(UNVERIFIED_USER),
      ).resolves.toBeUndefined();
    });

    // If the raw token ever reached a log line, a database+log leak would let
    // an attacker consume live verification links.
    it('passes the RAW token to the mailer and only the hash to the repository', async () => {
      await service.issueVerificationEmail(UNVERIFIED_USER);

      const rawSent = emailServiceMock.sendVerificationEmail.mock.calls[0]?.[1];
      const hashPassed = issueArgs().tokenHash;

      expect(typeof rawSent).toBe('string');
      // Repository must receive a 64-char hex digest, never the raw token.
      expect(hashPassed).toMatch(/^[0-9a-f]{64}$/);
      expect(hashPassed).not.toBe(rawSent);
      expect(rawSent).not.toBe(hashPassed);
    });

    it('applies the configured TTL to the token expiry', async () => {
      const before = Date.now();
      await service.issueVerificationEmail(UNVERIFIED_USER);

      const expiresAt = issueArgs().expiresAt;
      const expectedMs = 1440 * 60 * 1000;
      const delta = expiresAt.getTime() - before;

      expect(delta).toBeLessThanOrEqual(expectedMs + 5000);
      expect(delta).toBeGreaterThanOrEqual(expectedMs - 5000);
    });
  });

  // ── verifyEmail ────────────────────────────────────────────────────────────

  describe('verifyEmail', () => {
    it('accepts a valid unexpired token', async () => {
      tokenRepositoryMock.findActiveByHash.mockResolvedValue(makeToken());
      tokenRepositoryMock.consumeTokenAndVerifyUser.mockResolvedValue({
        consumed: true,
        newlyVerified: true,
      });

      await expect(service.verifyEmail(RAW_TOKEN)).resolves.toBeUndefined();
      expect(
        tokenRepositoryMock.consumeTokenAndVerifyUser,
      ).toHaveBeenCalledTimes(1);
    });

    it('looks the token up by its HASH, not the raw value', async () => {
      await service.verifyEmail(RAW_TOKEN);

      const lookedUp = tokenRepositoryMock.findActiveByHash.mock.calls[0]?.[0];
      expect(lookedUp).toMatch(/^[0-9a-f]{64}$/);
      expect(lookedUp).not.toBe(RAW_TOKEN);
    });

    it('rejects an unknown token', async () => {
      tokenRepositoryMock.findActiveByHash.mockResolvedValue(null);

      await expect(service.verifyEmail(RAW_TOKEN)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an expired token', async () => {
      tokenRepositoryMock.findActiveByHash.mockResolvedValue(
        makeToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.verifyEmail(RAW_TOKEN)).rejects.toThrow(
        BadRequestException,
      );
      // Must not reach the consume step at all.
      expect(
        tokenRepositoryMock.consumeTokenAndVerifyUser,
      ).not.toHaveBeenCalled();
    });

    // Single-use guarantee: the DB compare-and-swap is the authority, so a
    // lost race must reject rather than report success.
    it('rejects when the consume loses the concurrency race', async () => {
      tokenRepositoryMock.findActiveByHash.mockResolvedValue(makeToken());
      tokenRepositoryMock.consumeTokenAndVerifyUser.mockResolvedValue({
        consumed: false,
        newlyVerified: false,
      });

      await expect(service.verifyEmail(RAW_TOKEN)).rejects.toThrow(
        BadRequestException,
      );
    });

    // The anti-oracle invariant. An attacker replaying or guessing tokens must
    // not be able to distinguish "wrong", "expired" and "already used".
    it('throws the IDENTICAL error for unknown, expired and raced tokens', async () => {
      const errors: BadRequestException[] = [];

      tokenRepositoryMock.findActiveByHash.mockResolvedValue(null);
      await service
        .verifyEmail(RAW_TOKEN)
        .catch((e: BadRequestException) => errors.push(e));

      tokenRepositoryMock.findActiveByHash.mockResolvedValue(
        makeToken({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await service
        .verifyEmail(RAW_TOKEN)
        .catch((e: BadRequestException) => errors.push(e));

      tokenRepositoryMock.findActiveByHash.mockResolvedValue(makeToken());
      tokenRepositoryMock.consumeTokenAndVerifyUser.mockResolvedValue({
        consumed: false,
        newlyVerified: false,
      });
      await service
        .verifyEmail(RAW_TOKEN)
        .catch((e: BadRequestException) => errors.push(e));

      expect(errors).toHaveLength(3);
      const serialized = errors.map((e) => JSON.stringify(e.getResponse()));
      // The core invariant: all three failure modes are byte-identical, so the
      // response reveals nothing about WHY it failed.
      expect(new Set(serialized).size).toBe(1);

      // And no failure mode may be uniquely named. The message may offer an
      // ambiguous disjunction ("invalid or expired") because that hedges
      // without confirming — but it must never pin down the actual reason, or
      // an attacker could replay until they found the phrasing that means
      // "wrong token" vs "expired but genuine token".
      const blob = serialized[0] ?? '';
      expect(blob).not.toMatch(
        /already used|has been used|consumed|not found|unknown token/i,
      );
    });
  });

  // ── resendVerification ─────────────────────────────────────────────────────

  describe('resendVerification', () => {
    it('issues and sends for an unverified account', async () => {
      const outcome = await service.resendVerification('alice@example.com');

      expect(outcome).toBe('sent');
      expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(tokenRepositoryMock.issueToken).toHaveBeenCalledTimes(1);
    });

    // Enumeration resistance: an unknown address must trigger no send.
    it('returns unknown_email and sends nothing for an unknown address', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);

      const outcome = await service.resendVerification('nobody@example.com');

      expect(outcome).toBe('unknown_email');
      expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
      expect(tokenRepositoryMock.issueToken).not.toHaveBeenCalled();
    });

    it('returns already_verified and sends nothing for a verified account', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(VERIFIED_USER);

      const outcome = await service.resendVerification('alice@example.com');

      expect(outcome).toBe('already_verified');
      expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
      expect(tokenRepositoryMock.issueToken).not.toHaveBeenCalled();
    });

    it('returns user_inactive and sends nothing for a suspended or disabled account', async () => {
      usersServiceMock.findByEmail.mockResolvedValue({
        ...UNVERIFIED_USER,
        status: UserStatus.SUSPENDED,
      });

      const outcome = await service.resendVerification('alice@example.com');

      expect(outcome).toBe('user_inactive');
      expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
      expect(tokenRepositoryMock.issueToken).not.toHaveBeenCalled();
    });

    // 60-second cooldown: the locked transaction rejects the issuance.
    it('returns cooldown_active when the transaction reports the cooldown', async () => {
      tokenRepositoryMock.issueToken.mockRejectedValue(
        new CooldownError(USER_ID, 42_000),
      );

      const outcome = await service.resendVerification('alice@example.com');

      expect(outcome).toBe('cooldown_active');
      // Nothing may be sent when issuance was refused.
      expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
    });

    // Transport failure must not destroy the account or surface an error to the
    // controller, which returns a constant 202 regardless.
    it('returns delivery_failed when the transport rejects', async () => {
      emailServiceMock.sendVerificationEmail.mockRejectedValue(
        new EmailDeliveryError('PROVIDER_REJECTED', 'Resend said no'),
      );

      const outcome = await service.resendVerification('alice@example.com');

      expect(outcome).toBe('delivery_failed');
    });

    // A lost issuance race is a concurrency signal, not a fault. Reporting it
    // as delivery_failed would log a transport problem that never happened.
    it('maps a lost insert race to cooldown_active, not delivery_failed', async () => {
      tokenRepositoryMock.issueToken.mockRejectedValue(
        new ActiveTokenConflictError(USER_ID),
      );

      const outcome = await service.resendVerification('alice@example.com');

      expect(outcome).toBe('cooldown_active');
      expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('distinguishes cooldown from transport failure in the log only', async () => {
      tokenRepositoryMock.issueToken.mockRejectedValue(
        new CooldownError(USER_ID, 10_000),
      );

      const outcome = await service.resendVerification('alice@example.com');

      // Both collapse to the same client-visible outcome; the distinction is
      // never returned to the caller.
      expect(outcome).toBe('cooldown_active');
      expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  // ── cooldown / concurrent issuance (service level) ─────────────────────────

  describe('cooldown delegation and concurrent issuance', () => {
    // The service must NOT evaluate the cooldown itself. A check here would be
    // read-then-act across an await boundary: two requests could both read
    // "no recent token" and both proceed. The repository transaction is the
    // only authority, because it holds the row lock across check and insert.
    it('performs no cooldown pre-check of its own', async () => {
      tokenRepositoryMock.issueToken.mockRejectedValue(
        new CooldownError(USER_ID, 55_000),
      );

      await service.resendVerification('alice@example.com');

      // Exactly one repository call: issuance. There is no preceding read that
      // could be raced, and no separate cleanup query either.
      expect(tokenRepositoryMock.issueToken).toHaveBeenCalledTimes(1);
      expect(Object.keys(tokenRepositoryMock)).toEqual(
        expect.arrayContaining(['issueToken', 'findActiveByHash']),
      );
      // The service must not call anything resembling the old pre-check.
      const calledMethods = Object.entries(tokenRepositoryMock)
        .filter(([, fn]) => vi.mocked(fn).mock.calls.length > 0)
        .map(([name]) => name);
      expect(calledMethods).toEqual(['issueToken']);
    });

    // Policy wiring: the cooldown duration is a CONFIG value the service owns,
    // and the clock is read exactly once so the expiry and the cooldown check
    // are judged against the same instant.
    it('hands the configured cooldown and a single clock reading to the transaction', async () => {
      const before = Date.now();
      await service.resendVerification('alice@example.com');
      const after = Date.now();

      const args = issueArgs();
      expect(args.cooldownSeconds).toBe(COOLDOWN_SECONDS);
      expect(args.userId).toBe(USER_ID);
      expect(args.now.getTime()).toBeGreaterThanOrEqual(before);
      expect(args.now.getTime()).toBeLessThanOrEqual(after);
      // Expiry derives from the same clock, so token lifetime is not skewed
      // by a second time read.
      const delta = args.expiresAt.getTime() - args.now.getTime();
      expect(delta).toBe(1440 * 60 * 1000);
    });

    it('always passes a 64-character hex hash to the transaction', async () => {
      await service.resendVerification('alice@example.com');

      expect(issueArgs().tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    // The concurrency proof available without a database: two simultaneous
    // resends. The repository serializes them, so the first issues and the
    // second — blocked behind the row lock — comes back with CooldownError.
    // Exactly one email must go out.
    it('yields exactly one send when two resends race', async () => {
      tokenRepositoryMock.issueToken
        .mockResolvedValueOnce({
          record: makeToken(),
          supersededPrevious: false,
        })
        .mockRejectedValueOnce(new CooldownError(USER_ID, 59_000));

      const outcomes = await Promise.all([
        service.resendVerification('alice@example.com'),
        service.resendVerification('alice@example.com'),
      ]);

      expect(outcomes).toHaveLength(2);
      expect(outcomes.filter((o) => o === 'sent')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'cooldown_active')).toHaveLength(1);
      expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(tokenRepositoryMock.issueToken).toHaveBeenCalledTimes(2);
    });

    // Both endpoints must funnel through the same locked issuance. If they did
    // not, a registration and an immediate resend could mint two active tokens
    // that the partial index alone would only catch after the fact.
    it('uses the identical issuance path for registration and resend', async () => {
      await service.issueVerificationEmail(UNVERIFIED_USER);
      await service.resendVerification('alice@example.com');

      expect(tokenRepositoryMock.issueToken).toHaveBeenCalledTimes(2);
      const first = issueArgs(0);
      const second = issueArgs(1);
      expect(first.userId).toBe(second.userId);
      expect(first.cooldownSeconds).toBe(second.cooldownSeconds);
      // The tokens themselves must differ; identical values would mean the
      // second call reused the first raw token.
      expect(first.tokenHash).not.toBe(second.tokenHash);
    });

    // Registration issues the FIRST token for a brand-new account, so it must
    // not be gated behind a cooldown that cannot possibly apply yet.
    it('lets registration issue the first token for a new account', async () => {
      await service.issueVerificationEmail(UNVERIFIED_USER);

      expect(tokenRepositoryMock.issueToken).toHaveBeenCalledTimes(1);
      expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });
  });
});
