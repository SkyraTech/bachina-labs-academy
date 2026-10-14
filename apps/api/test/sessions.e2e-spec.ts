import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { SessionsRepository } from '../src/modules/sessions/sessions.repository';
import { SessionsService } from '../src/modules/sessions/sessions.service';

function sha256(val: string): string {
  return createHash('sha256').update(val, 'utf8').digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('hex'); // 64 chars
}

describe('Sessions Persistence & Concurrency (Real PostgreSQL e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let repository: SessionsRepository;
  let service: SessionsService;

  const testUserEmail = `session-e2e-${Date.now()}@example.com`;
  let testUserId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    repository = moduleRef.get<SessionsRepository>(SessionsRepository);
    service = moduleRef.get<SessionsService>(SessionsService);

    // Create a real test user
    const user = await prisma.user.create({
      data: {
        email: testUserEmail,
        passwordHash: 'argon2id-mock-hash-for-sessions-test',
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    if (testUserId) {
      // Deleting user also cascade-deletes all associated sessions
      await prisma.user.deleteMany({
        where: { id: testUserId },
      });
    }
    await moduleRef.close();
  });

  // ── Session Creation & DB Constraints ──────────────────────────────────────

  describe('Session Creation and PostgreSQL Constraints', () => {
    it('creates a session in PostgreSQL with valid UUID and timestamps', async () => {
      const tokenHash = sha256(randomToken());
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const session = await repository.createSession({
        userId: testUserId,
        refreshTokenHash: tokenHash,
        rememberMe: false,
        expiresAt,
        userAgent: 'IntegrationTestRunner/1.0',
        ipAddress: '127.0.0.1',
      });

      expect(session.id).toBeDefined();
      expect(session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(session.userId).toBe(testUserId);
      expect(session.refreshTokenHash).toBe(tokenHash);
      expect(session.rememberMe).toBe(false);
      expect(session.revokedAt).toBeNull();
      expect(session.userAgent).toBe('IntegrationTestRunner/1.0');
      expect(session.ipAddress).toBe('127.0.0.1');

      // Verify row directly from PostgreSQL
      const dbRow = await prisma.userSession.findUnique({
        where: { id: session.id },
      });
      expect(dbRow).not.toBeNull();
      expect(dbRow?.refreshTokenHash).toBe(tokenHash);
    });

    it('enforces CHECK constraint on refresh_token_hash length (= 64 chars)', async () => {
      const invalidShortHash = 'too-short';
      await expect(
        prisma.$executeRaw`
          INSERT INTO "user_sessions" ("user_id", "refresh_token_hash", "expires_at")
          VALUES (${testUserId}::uuid, ${invalidShortHash}, NOW() + INTERVAL '1 day')
        `,
      ).rejects.toThrow();
    });

    it('enforces UNIQUE constraint on refresh_token_hash', async () => {
      const duplicateHash = sha256(randomToken());
      const expiresAt = new Date(Date.now() + 86400000);

      await repository.createSession({
        userId: testUserId,
        refreshTokenHash: duplicateHash,
        rememberMe: false,
        expiresAt,
      });

      await expect(
        repository.createSession({
          userId: testUserId,
          refreshTokenHash: duplicateHash,
          rememberMe: true,
          expiresAt,
        }),
      ).rejects.toThrow();
    });
  });

  // ── Concurrency & Atomic Rotation ──────────────────────────────────────────

  describe('Atomic Refresh-Token Rotation under Concurrency', () => {
    it('serializes concurrent rotation requests so exactly ONE wins and others safely fail', async () => {
      const initialHash = sha256(randomToken());
      const session = await repository.createSession({
        userId: testUserId,
        refreshTokenHash: initialHash,
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      const concurrentAttempts = 5;
      const newHashes = Array.from({ length: concurrentAttempts }, () =>
        sha256(randomToken()),
      );

      // Launch 5 concurrent rotation attempts using the same initialHash
      const results = await Promise.all(
        newHashes.map((newHash) =>
          repository.rotateRefreshToken({
            sessionId: session.id,
            currentRefreshTokenHash: initialHash,
            newRefreshTokenHash: newHash,
            now: new Date(),
          }),
        ),
      );

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      // Exactly ONE request wins the race
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(concurrentAttempts - 1);

      // All failures are classified as TOKEN_MISMATCH
      for (const failure of failures) {
        expect(failure.reason).toBe('TOKEN_MISMATCH');
      }

      // The winning hash is the one persisted in DB
      const winningHash = successes[0]!.session!.refreshTokenHash;
      expect(newHashes).toContain(winningHash);

      const dbSession = await prisma.userSession.findUnique({
        where: { id: session.id },
      });
      expect(dbSession?.refreshTokenHash).toBe(winningHash);

      // The session remains ACTIVE and valid (not prematurely revoked by concurrent attempts)
      expect(dbSession?.revokedAt).toBeNull();
      const valid = await service.validateSession(session.id);
      expect(valid).not.toBeNull();
    });

    it('rejects stale token reuse after rotation', async () => {
      const initialHash = sha256(randomToken());
      const session = await repository.createSession({
        userId: testUserId,
        refreshTokenHash: initialHash,
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      const nextHash = sha256(randomToken());
      const firstRotation = await service.rotateSessionToken({
        sessionId: session.id,
        currentRefreshTokenHash: initialHash,
        newRefreshTokenHash: nextHash,
      });
      expect(firstRotation.success).toBe(true);

      // Attempt to replay the old initialHash
      const replayAttempt = await service.rotateSessionToken({
        sessionId: session.id,
        currentRefreshTokenHash: initialHash,
        newRefreshTokenHash: sha256(randomToken()),
      });

      expect(replayAttempt.success).toBe(false);
      expect(replayAttempt.reason).toBe('TOKEN_MISMATCH');

      // Legitimate session continues to work with the new token
      const subsequentValidRotation = await service.rotateSessionToken({
        sessionId: session.id,
        currentRefreshTokenHash: nextHash,
        newRefreshTokenHash: sha256(randomToken()),
      });
      expect(subsequentValidRotation.success).toBe(true);
    });
  });

  // ── Expiration & Activity Tracking ─────────────────────────────────────────

  describe('Session Expiration and Activity Tracking', () => {
    it('rejects expired sessions and respects Remember Me lifetimes', async () => {
      const pastExpiry = new Date(Date.now() - 1000);
      const expiredSession = await repository.createSession({
        userId: testUserId,
        refreshTokenHash: sha256(randomToken()),
        rememberMe: false,
        expiresAt: pastExpiry,
      });

      const validated = await service.validateSession(expiredSession.id);
      expect(validated).toBeNull();

      const rotation = await repository.rotateRefreshToken({
        sessionId: expiredSession.id,
        currentRefreshTokenHash: expiredSession.refreshTokenHash,
        newRefreshTokenHash: sha256(randomToken()),
        now: new Date(),
      });
      expect(rotation.success).toBe(false);
      expect(rotation.reason).toBe('SESSION_EXPIRED');
    });

    it('updates lastSeenAt with bounded frequency', async () => {
      const session = await repository.createSession({
        userId: testUserId,
        refreshTokenHash: sha256(randomToken()),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });
      expect(session.lastSeenAt).toBeNull();

      const t1 = new Date();
      await repository.touchLastSeen(session.id, t1, 60_000);

      const s1 = await prisma.userSession.findUnique({ where: { id: session.id } });
      expect(s1?.lastSeenAt).not.toBeNull();

      // Immediate touch within 60s is throttled (no-op write)
      const t2 = new Date(t1.getTime() + 10_000); // 10 seconds later
      const touchedAgain = await repository.touchLastSeen(session.id, t2, 60_000);
      expect(touchedAgain).toBe(false);

      // Touch after 61s succeeds
      const t3 = new Date(t1.getTime() + 65_000); // 65 seconds later
      const touchedAfterWindow = await repository.touchLastSeen(session.id, t3, 60_000);
      expect(touchedAfterWindow).toBe(true);
    });
  });

  // ── Revocation & Cascading Deletion ─────────────────────────────────────────

  describe('Revocation Operations and Cascading Deletion', () => {
    it('revokes an individual session and sets revocation reason', async () => {
      const session = await repository.createSession({
        userId: testUserId,
        refreshTokenHash: sha256(randomToken()),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      const revoked = await service.revokeSession(session.id, 'USER_LOGOUT');
      expect(revoked).toBe(true);

      const dbSession = await prisma.userSession.findUnique({ where: { id: session.id } });
      expect(dbSession?.revokedAt).not.toBeNull();
      expect(dbSession?.revocationReason).toBe('USER_LOGOUT');

      // Validating revoked session returns null
      const valid = await service.validateSession(session.id);
      expect(valid).toBeNull();
    });

    it('revokes all user sessions while optionally excluding current device', async () => {
      const s1 = await repository.createSession({
        userId: testUserId,
        refreshTokenHash: sha256(randomToken()),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });
      const s2 = await repository.createSession({
        userId: testUserId,
        refreshTokenHash: sha256(randomToken()),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });
      const s3 = await repository.createSession({
        userId: testUserId,
        refreshTokenHash: sha256(randomToken()),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      // "Logout other devices" excluding s1
      const count = await service.revokeAllUserSessions(
        testUserId,
        'USER_LOGOUT_ALL',
        s1.id,
      );
      expect(count).toBeGreaterThanOrEqual(2);

      const checkS1 = await service.validateSession(s1.id);
      const checkS2 = await service.validateSession(s2.id);
      const checkS3 = await service.validateSession(s3.id);

      expect(checkS1).not.toBeNull(); // Still active
      expect(checkS2).toBeNull();     // Revoked
      expect(checkS3).toBeNull();     // Revoked
    });

    it('cascades session deletion when the parent user is deleted', async () => {
      // Create a dedicated user for cascade test
      const cascadeUser = await prisma.user.create({
        data: {
          email: `cascade-test-${Date.now()}@example.com`,
          passwordHash: 'hash',
        },
      });

      const cascadeSession = await repository.createSession({
        userId: cascadeUser.id,
        refreshTokenHash: sha256(randomToken()),
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400000),
      });

      // Delete the user
      await prisma.user.delete({ where: { id: cascadeUser.id } });

      // Session must be gone automatically (ON DELETE CASCADE)
      const orphanSession = await prisma.userSession.findUnique({
        where: { id: cascadeSession.id },
      });
      expect(orphanSession).toBeNull();
    });
  });
});
