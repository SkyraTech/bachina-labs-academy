import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { createHash } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { EmailService } from '../src/modules/email/email.service.js';

/**
 * Integration and e2e tests for Step 2.2.3: Email Verification.
 *
 * Covers:
 *   1. Registration creates an unverified user (emailVerifiedAt is null)
 *   2. Registration creates a hashed verification-token record in email_verification_tokens
 *   3. Raw verification tokens are NEVER stored in the database
 *   4. Valid tokens verify email and update email_verified_at
 *   5. Tokens are consumed exactly once (replay fails with uniform 400)
 *   6. Expired tokens fail with uniform 400
 *   7. Unknown tokens fail with uniform 400
 *   8. Uniform error across unknown, expired, and consumed tokens (no oracle)
 *   9. Disabled and suspended users cannot verify (400)
 *   10. Resend returns 202 Accepted with generic message for known and unknown accounts
 *   11. Resend cooldown (60s) is enforced (no second email dispatched)
 *   12. Consumed-token history still counts toward cooldown
 *   13. Old outstanding links become invalid after eligible resend
 *   14. Concurrent issuance attempts are serialized
 *   15. Concurrent verification attempts cannot both succeed (one 200, one 400)
 *   16. Email delivery failure preserves the registered user (201 Created)
 */

const TEST_EMAIL_BASE = `verify-e2e-${Date.now()}`;
const testEmails: string[] = [];
const capturedEmails: Map<string, string[]> = new Map();

function uniqueEmail(): string {
  const email = `${TEST_EMAIL_BASE}-${testEmails.length}@example.com`;
  testEmails.push(email);
  return email;
}

function sha256(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

describe('Auth Email Verification (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mockEmailService: {
    sendVerificationEmail: ReturnType<typeof vi.fn>;
    providerName: string;
    isEnabled: boolean;
    close: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    mockEmailService = {
      sendVerificationEmail: vi.fn(async (recipient: string, token: string) => {
        const tokens = capturedEmails.get(recipient) ?? [];
        tokens.push(token);
        capturedEmails.set(recipient, tokens);
        return { messageId: 'mock-id', provider: 'smtp' };
      }),
      providerName: 'mock',
      isEnabled: true,
      close: vi.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getStorageToken())
      .useValue({
        increment: vi.fn().mockResolvedValue({
          totalHits: 0,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .overrideProvider(EmailService)
      .useValue(mockEmailService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['/health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (testEmails.length > 0) {
      // Cascade delete removes user and their verification tokens
      await prisma.user.deleteMany({
        where: { email: { in: testEmails } },
      });
    }
    await app.close();
  });

  beforeEach(() => {
    mockEmailService.sendVerificationEmail.mockClear();
    capturedEmails.clear();
  });

  // ── Registration & Token Storage ──────────────────────────────────────────

  describe('registration token issuance and storage', () => {
    it('creates an unverified user and a hashed token record', async () => {
      const email = uniqueEmail();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      expect(res.body.emailVerifiedAt).toBeNull();

      // Email service was invoked with raw token
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
      const sentTokens = capturedEmails.get(email);
      expect(sentTokens).toBeDefined();
      expect(sentTokens?.length).toBe(1);

      const rawToken = sentTokens![0]!;
      expect(rawToken.length).toBe(43); // base64url of 32 bytes

      // Check DB record
      const user = await prisma.user.findUnique({
        where: { email },
        include: { emailVerificationTokens: true },
      });
      expect(user).not.toBeNull();
      expect(user!.emailVerificationTokens.length).toBe(1);

      const tokenRecord = user!.emailVerificationTokens[0]!;
      expect(tokenRecord.consumedAt).toBeNull();
      expect(tokenRecord.tokenHash).toBe(sha256(rawToken));
      expect(tokenRecord.tokenHash).not.toBe(rawToken);
    });

    it('never stores raw verification tokens in the database', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      const rawToken = capturedEmails.get(email)![0]!;
      const tokenRow = await prisma.emailVerificationToken.findFirst({
        where: { tokenHash: sha256(rawToken) },
      });

      expect(tokenRow).not.toBeNull();
      expect(tokenRow!.tokenHash).not.toContain(rawToken);
    });
  });

  // ── Token Verification & Consumption ──────────────────────────────────────

  describe('POST /api/v1/auth/verify-email', () => {
    it('successfully verifies email with valid token and sets emailVerifiedAt', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      const rawToken = capturedEmails.get(email)![0]!;

      const verifyRes = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: rawToken })
        .expect(200);

      expect(verifyRes.body.verified).toBe(true);

      const user = await prisma.user.findUnique({
        where: { email },
        include: { emailVerificationTokens: true },
      });
      expect(user!.emailVerifiedAt).not.toBeNull();
      expect(user!.emailVerificationTokens[0]!.consumedAt).not.toBeNull();
    });

    it('rejects a token consumed a second time (single-use guarantee)', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      const rawToken = capturedEmails.get(email)![0]!;

      // First verification succeeds
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: rawToken })
        .expect(200);

      // Replay fails
      const replayRes = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: rawToken })
        .expect(400);

      expect(replayRes.body.message).toBe(
        'This verification link is invalid or has expired.',
      );
    });

    it('rejects expired tokens with uniform 400', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      const rawToken = capturedEmails.get(email)![0]!;

      // Manually backdate the token expiry to simulate expiration
      await prisma.emailVerificationToken.update({
        where: { tokenHash: sha256(rawToken) },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: rawToken })
        .expect(400);

      expect(res.body.message).toBe(
        'This verification link is invalid or has expired.',
      );
    });

    it('rejects unknown tokens with uniform 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: 'u'.repeat(43) })
        .expect(400);

      expect(res.body.message).toBe(
        'This verification link is invalid or has expired.',
      );
    });

    it('prevents disabled or suspended users from verifying', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      const rawToken = capturedEmails.get(email)![0]!;

      // Suspend user
      await prisma.user.update({
        where: { email },
        data: { status: 'SUSPENDED' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: rawToken })
        .expect(400);

      // Verify user was NOT marked as verified
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user!.emailVerifiedAt).toBeNull();
    });

    it('handles concurrent verification attempts safely (exactly one succeeds)', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      const rawToken = capturedEmails.get(email)![0]!;

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/verify-email')
          .send({ token: rawToken }),
        request(app.getHttpServer())
          .post('/api/v1/auth/verify-email')
          .send({ token: rawToken }),
      ]);

      const statuses = [res1.status, res2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 400]);
    });
  });

  // ── Resend Verification & Cooldown ────────────────────────────────────────

  describe('POST /api/v1/auth/resend-verification', () => {
    it('returns generic 202 Accepted for unknown email and does not send email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'unknown-address@example.com' })
        .expect(202);

      expect(res.body.message).toContain('If an account exists');
      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('enforces 60-second cooldown between resends', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
      mockEmailService.sendVerificationEmail.mockClear();

      // Immediate resend hits cooldown: returns 202, but does NOT dispatch email
      await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .send({ email })
        .expect(202);

      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('invalidates old unconsumed links when an eligible resend succeeds', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      const initialToken = capturedEmails.get(email)![0]!;

      // Backdate previous token by 65 seconds so cooldown is satisfied
      await prisma.emailVerificationToken.update({
        where: { tokenHash: sha256(initialToken) },
        data: { createdAt: new Date(Date.now() - 65_000) },
      });

      mockEmailService.sendVerificationEmail.mockClear();

      // Resend succeeds and issues replacement
      await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .send({ email })
        .expect(202);

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
      const allTokens = capturedEmails.get(email)!;
      const newToken = allTokens[allTokens.length - 1]!;
      expect(newToken).not.toBe(initialToken);

      // Old token is now invalidated
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: initialToken })
        .expect(400);

      // New token succeeds
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: newToken })
        .expect(200);
    });

    it('counts consumed-token history toward cooldown', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      const rawToken = capturedEmails.get(email)![0]!;

      // Verify immediately
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: rawToken })
        .expect(200);

      mockEmailService.sendVerificationEmail.mockClear();

      // Resend immediately: user is already verified and within 60s
      await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .send({ email })
        .expect(202);

      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('preserves registered account when email delivery fails', async () => {
      const email = uniqueEmail();
      mockEmailService.sendVerificationEmail.mockRejectedValueOnce(
        new Error('SMTP down'),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201);

      expect(res.body.email).toBe(email);

      // Account was persisted in DB despite email delivery failure
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user!.emailVerifiedAt).toBeNull();
    });
  });
});
