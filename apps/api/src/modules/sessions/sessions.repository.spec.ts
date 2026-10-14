import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { UserSession } from '@prisma/client';
import { SessionsRepository } from './sessions.repository';
import { PrismaService } from '../../database/prisma.service';

const MOCK_DATE = new Date('2026-10-14T12:00:00.000Z');
const MOCK_EXPIRY = new Date('2026-10-15T12:00:00.000Z');
const MOCK_HASH_1 = 'a'.repeat(64);
const MOCK_HASH_2 = 'b'.repeat(64);

const MOCK_SESSION: UserSession = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  refreshTokenHash: MOCK_HASH_1,
  rememberMe: false,
  createdAt: MOCK_DATE,
  lastSeenAt: null,
  expiresAt: MOCK_EXPIRY,
  revokedAt: null,
  revocationReason: null,
  userAgent: 'TestBrowser',
  ipAddress: '127.0.0.1',
};

describe('SessionsRepository', () => {
  let repository: SessionsRepository;
  let prismaSessionMock: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prismaSessionMock = {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsRepository,
        {
          provide: PrismaService,
          useValue: { userSession: prismaSessionMock },
        },
      ],
    }).compile();

    repository = module.get<SessionsRepository>(SessionsRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('creates a session record with supplied inputs', async () => {
      prismaSessionMock.create.mockResolvedValue(MOCK_SESSION);

      const result = await repository.createSession({
        userId: MOCK_SESSION.userId,
        refreshTokenHash: MOCK_HASH_1,
        rememberMe: false,
        expiresAt: MOCK_EXPIRY,
        userAgent: 'TestBrowser',
        ipAddress: '127.0.0.1',
      });

      expect(prismaSessionMock.create).toHaveBeenCalledWith({
        data: {
          userId: MOCK_SESSION.userId,
          refreshTokenHash: MOCK_HASH_1,
          rememberMe: false,
          expiresAt: MOCK_EXPIRY,
          userAgent: 'TestBrowser',
          ipAddress: '127.0.0.1',
        },
      });
      expect(result).toEqual(MOCK_SESSION);
    });
  });

  describe('findById', () => {
    it('returns session if found', async () => {
      prismaSessionMock.findUnique.mockResolvedValue(MOCK_SESSION);

      const result = await repository.findById(MOCK_SESSION.id);
      expect(prismaSessionMock.findUnique).toHaveBeenCalledWith({
        where: { id: MOCK_SESSION.id },
      });
      expect(result).toEqual(MOCK_SESSION);
    });

    it('returns null if not found', async () => {
      prismaSessionMock.findUnique.mockResolvedValue(null);

      const result = await repository.findById('unknown-id');
      expect(result).toBeNull();
    });
  });

  describe('findByRefreshTokenHash', () => {
    it('queries by refreshTokenHash', async () => {
      prismaSessionMock.findUnique.mockResolvedValue(MOCK_SESSION);

      const result = await repository.findByRefreshTokenHash(MOCK_HASH_1);
      expect(prismaSessionMock.findUnique).toHaveBeenCalledWith({
        where: { refreshTokenHash: MOCK_HASH_1 },
      });
      expect(result).toEqual(MOCK_SESSION);
    });
  });

  describe('findActiveById', () => {
    it('finds active session with unrevoked and unexpired constraints', async () => {
      prismaSessionMock.findFirst.mockResolvedValue(MOCK_SESSION);

      const result = await repository.findActiveById(MOCK_SESSION.id, MOCK_DATE);
      expect(prismaSessionMock.findFirst).toHaveBeenCalledWith({
        where: {
          id: MOCK_SESSION.id,
          revokedAt: null,
          expiresAt: { gt: MOCK_DATE },
        },
      });
      expect(result).toEqual(MOCK_SESSION);
    });
  });

  describe('rotateRefreshToken (Atomic Compare-and-Swap)', () => {
    it('succeeds when hash matches and session is active', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 1 });
      const updatedSession = { ...MOCK_SESSION, refreshTokenHash: MOCK_HASH_2 };
      prismaSessionMock.findUnique.mockResolvedValue(updatedSession);

      const result = await repository.rotateRefreshToken({
        sessionId: MOCK_SESSION.id,
        currentRefreshTokenHash: MOCK_HASH_1,
        newRefreshTokenHash: MOCK_HASH_2,
        now: MOCK_DATE,
      });

      expect(prismaSessionMock.updateMany).toHaveBeenCalledWith({
        where: {
          id: MOCK_SESSION.id,
          refreshTokenHash: MOCK_HASH_1,
          revokedAt: null,
          expiresAt: { gt: MOCK_DATE },
        },
        data: {
          refreshTokenHash: MOCK_HASH_2,
          lastSeenAt: MOCK_DATE,
        },
      });
      expect(result.success).toBe(true);
      expect(result.session).toEqual(updatedSession);
    });

    it('identifies TOKEN_MISMATCH when update fails and hash is different', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 0 });
      // Session exists with different hash
      prismaSessionMock.findUnique.mockResolvedValue({
        ...MOCK_SESSION,
        refreshTokenHash: 'c'.repeat(64),
      });

      const result = await repository.rotateRefreshToken({
        sessionId: MOCK_SESSION.id,
        currentRefreshTokenHash: MOCK_HASH_1,
        newRefreshTokenHash: MOCK_HASH_2,
        now: MOCK_DATE,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('TOKEN_MISMATCH');
    });

    it('identifies SESSION_REVOKED when session was already revoked', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 0 });
      prismaSessionMock.findUnique.mockResolvedValue({
        ...MOCK_SESSION,
        revokedAt: new Date(),
      });

      const result = await repository.rotateRefreshToken({
        sessionId: MOCK_SESSION.id,
        currentRefreshTokenHash: MOCK_HASH_1,
        newRefreshTokenHash: MOCK_HASH_2,
        now: MOCK_DATE,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('SESSION_REVOKED');
    });

    it('identifies SESSION_EXPIRED when session is past expiresAt', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 0 });
      prismaSessionMock.findUnique.mockResolvedValue({
        ...MOCK_SESSION,
        expiresAt: new Date(MOCK_DATE.getTime() - 1000),
      });

      const result = await repository.rotateRefreshToken({
        sessionId: MOCK_SESSION.id,
        currentRefreshTokenHash: MOCK_HASH_1,
        newRefreshTokenHash: MOCK_HASH_2,
        now: MOCK_DATE,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('SESSION_EXPIRED');
    });

    it('identifies SESSION_NOT_FOUND when record does not exist', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 0 });
      prismaSessionMock.findUnique.mockResolvedValue(null);

      const result = await repository.rotateRefreshToken({
        sessionId: 'unknown-session',
        currentRefreshTokenHash: MOCK_HASH_1,
        newRefreshTokenHash: MOCK_HASH_2,
        now: MOCK_DATE,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('touchLastSeen', () => {
    it('applies bounded frequency threshold condition', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 1 });

      const updated = await repository.touchLastSeen(MOCK_SESSION.id, MOCK_DATE, 60_000);
      expect(updated).toBe(true);

      const expectedThreshold = new Date(MOCK_DATE.getTime() - 60_000);
      expect(prismaSessionMock.updateMany).toHaveBeenCalledWith({
        where: {
          id: MOCK_SESSION.id,
          revokedAt: null,
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: expectedThreshold } }],
        },
        data: { lastSeenAt: MOCK_DATE },
      });
    });
  });

  describe('revokeSession', () => {
    it('sets revokedAt and revocationReason on active session', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 1 });

      const res = await repository.revokeSession(MOCK_SESSION.id, MOCK_DATE, 'USER_LOGOUT');
      expect(res).toBe(true);
      expect(prismaSessionMock.updateMany).toHaveBeenCalledWith({
        where: { id: MOCK_SESSION.id, revokedAt: null },
        data: { revokedAt: MOCK_DATE, revocationReason: 'USER_LOGOUT' },
      });
    });
  });

  describe('revokeAllUserSessions', () => {
    it('revokes all active sessions of user excluding designated session', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 3 });

      const count = await repository.revokeAllUserSessions(
        MOCK_SESSION.userId,
        MOCK_DATE,
        'USER_LOGOUT_ALL',
        'current-session-id',
      );

      expect(count).toBe(3);
      expect(prismaSessionMock.updateMany).toHaveBeenCalledWith({
        where: {
          userId: MOCK_SESSION.userId,
          revokedAt: null,
          id: { not: 'current-session-id' },
        },
        data: { revokedAt: MOCK_DATE, revocationReason: 'USER_LOGOUT_ALL' },
      });
    });
  });

  describe('listUserSessions', () => {
    it('explicitly excludes refreshTokenHash from query select', async () => {
      prismaSessionMock.findMany.mockResolvedValue([
        {
          id: MOCK_SESSION.id,
          userId: MOCK_SESSION.userId,
          rememberMe: false,
          createdAt: MOCK_DATE,
          lastSeenAt: null,
          expiresAt: MOCK_EXPIRY,
          revokedAt: null,
          userAgent: 'TestBrowser',
          ipAddress: '127.0.0.1',
        },
      ]);

      const list = await repository.listUserSessions(MOCK_SESSION.userId);
      expect(list.length).toBe(1);
      expect((list[0] as unknown as Record<string, unknown>).refreshTokenHash).toBeUndefined();

      const callArgs = prismaSessionMock.findMany.mock.calls[0]![0];
      expect(callArgs.select.refreshTokenHash).toBeUndefined();
      expect(callArgs.select.id).toBe(true);
      expect(callArgs.select.userId).toBe(true);
    });
  });

  describe('deleteExpiredSessions', () => {
    it('deletes sessions past expiration or retention period', async () => {
      prismaSessionMock.deleteMany.mockResolvedValue({ count: 5 });

      const count = await repository.deleteExpiredSessions(MOCK_DATE);
      expect(count).toBe(5);
      expect(prismaSessionMock.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: { lt: MOCK_DATE } }, { revokedAt: { lt: MOCK_DATE } }],
        },
      });
    });
  });

  describe('revokeUserSession', () => {
    it('atomically revokes session matching both id and userId when unrevoked', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.revokeUserSession(
        MOCK_SESSION.id,
        MOCK_SESSION.userId,
        MOCK_DATE,
        'USER_LOGOUT',
      );

      expect(result).toBe(true);
      expect(prismaSessionMock.updateMany).toHaveBeenCalledWith({
        where: {
          id: MOCK_SESSION.id,
          userId: MOCK_SESSION.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: MOCK_DATE,
          revocationReason: 'USER_LOGOUT',
        },
      });
    });

    it('returns false when 0 rows match (not owned, nonexistent, or already revoked)', async () => {
      prismaSessionMock.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.revokeUserSession(
        'other-session-id',
        MOCK_SESSION.userId,
        MOCK_DATE,
        'USER_LOGOUT',
      );

      expect(result).toBe(false);
    });
  });

  describe('listActiveUserSessions', () => {
    it('filters for unrevoked, unexpired sessions and orders by activity', async () => {
      prismaSessionMock.findMany.mockResolvedValue([
        {
          id: MOCK_SESSION.id,
          userId: MOCK_SESSION.userId,
          rememberMe: false,
          createdAt: MOCK_DATE,
          lastSeenAt: MOCK_DATE,
          expiresAt: MOCK_EXPIRY,
          revokedAt: null,
          userAgent: 'TestBrowser',
          ipAddress: '127.0.0.1',
        },
      ]);

      const result = await repository.listActiveUserSessions(
        MOCK_SESSION.userId,
        MOCK_DATE,
      );

      expect(result.length).toBe(1);
      expect(prismaSessionMock.findMany).toHaveBeenCalledWith({
        where: {
          userId: MOCK_SESSION.userId,
          revokedAt: null,
          expiresAt: { gt: MOCK_DATE },
        },
        orderBy: [
          { lastSeenAt: 'desc' },
          { createdAt: 'desc' },
        ],
        select: expect.objectContaining({
          id: true,
          userId: true,
          rememberMe: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
          revokedAt: true,
          userAgent: true,
          ipAddress: true,
        }),
      });
    });
  });
});
