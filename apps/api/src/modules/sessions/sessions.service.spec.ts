import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { UserSession } from '@prisma/client';
import { SessionsService } from './sessions.service';
import { SessionsRepository } from './sessions.repository';

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
  userAgent: 'Mozilla/5.0',
  ipAddress: '192.168.1.1',
};

describe('SessionsService', () => {
  let service: SessionsService;
  let mockRepository: {
    createSession: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByRefreshTokenHash: ReturnType<typeof vi.fn>;
    findActiveById: ReturnType<typeof vi.fn>;
    rotateRefreshToken: ReturnType<typeof vi.fn>;
    touchLastSeen: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
    revokeAllUserSessions: ReturnType<typeof vi.fn>;
    revokeUserSession: ReturnType<typeof vi.fn>;
    listUserSessions: ReturnType<typeof vi.fn>;
    listActiveUserSessions: ReturnType<typeof vi.fn>;
    deleteExpiredSessions: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRepository = {
      createSession: vi.fn(),
      findById: vi.fn(),
      findByRefreshTokenHash: vi.fn(),
      findActiveById: vi.fn(),
      rotateRefreshToken: vi.fn(),
      touchLastSeen: vi.fn(),
      revokeSession: vi.fn(),
      revokeAllUserSessions: vi.fn(),
      revokeUserSession: vi.fn(),
      listUserSessions: vi.fn(),
      listActiveUserSessions: vi.fn(),
      deleteExpiredSessions: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        {
          provide: SessionsRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── calculateExpiry ────────────────────────────────────────────────────────

  describe('calculateExpiry', () => {
    it('calculates 24-hour expiry when rememberMe is false', () => {
      const now = new Date('2026-10-14T10:00:00.000Z');
      const expiry = service.calculateExpiry(false, now);

      const diffMs = expiry.getTime() - now.getTime();
      expect(diffMs).toBe(24 * 60 * 60 * 1000);
    });

    it('calculates 30-day expiry when rememberMe is true', () => {
      const now = new Date('2026-10-14T10:00:00.000Z');
      const expiry = service.calculateExpiry(true, now);

      const diffMs = expiry.getTime() - now.getTime();
      expect(diffMs).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  // ── createSession ──────────────────────────────────────────────────────────

  describe('createSession', () => {
    it('creates a session with computed expiry and returns SafeSession', async () => {
      mockRepository.createSession.mockResolvedValue(MOCK_SESSION);

      const safe = await service.createSession({
        userId: MOCK_SESSION.userId,
        refreshTokenHash: MOCK_HASH_1,
        rememberMe: false,
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
        now: MOCK_DATE,
      });

      expect(mockRepository.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: MOCK_SESSION.userId,
          refreshTokenHash: MOCK_HASH_1,
          rememberMe: false,
          expiresAt: expect.any(Date),
        }),
      );

      // Verify no leakage of hash
      expect((safe as unknown as Record<string, unknown>).refreshTokenHash).toBeUndefined();
      expect(safe.id).toBe(MOCK_SESSION.id);
      expect(safe.userId).toBe(MOCK_SESSION.userId);
    });
  });

  // ── validateSession ────────────────────────────────────────────────────────

  describe('validateSession', () => {
    it('returns null if session not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await service.validateSession('missing-id', MOCK_DATE);
      expect(result).toBeNull();
      expect(mockRepository.touchLastSeen).not.toHaveBeenCalled();
    });

    it('returns null if session is revoked', async () => {
      mockRepository.findById.mockResolvedValue({
        ...MOCK_SESSION,
        revokedAt: new Date('2026-10-14T11:00:00.000Z'),
      });

      const result = await service.validateSession(MOCK_SESSION.id, MOCK_DATE);
      expect(result).toBeNull();
      expect(mockRepository.touchLastSeen).not.toHaveBeenCalled();
    });

    it('returns null if session has expired', async () => {
      mockRepository.findById.mockResolvedValue({
        ...MOCK_SESSION,
        expiresAt: new Date('2026-10-14T11:59:59.000Z'),
      });

      const result = await service.validateSession(MOCK_SESSION.id, MOCK_DATE);
      expect(result).toBeNull();
      expect(mockRepository.touchLastSeen).not.toHaveBeenCalled();
    });

    it('returns SafeSession and updates lastSeenAt when session is valid', async () => {
      mockRepository.findById.mockResolvedValue(MOCK_SESSION);

      const result = await service.validateSession(MOCK_SESSION.id, MOCK_DATE);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(MOCK_SESSION.id);
      expect((result as unknown as Record<string, unknown>)?.refreshTokenHash).toBeUndefined();
      expect(mockRepository.touchLastSeen).toHaveBeenCalledWith(MOCK_SESSION.id, MOCK_DATE);
    });
  });

  // ── rotateSessionToken ─────────────────────────────────────────────────────

  describe('rotateSessionToken', () => {
    it('returns safe session when rotation succeeds', async () => {
      const updatedSession = { ...MOCK_SESSION, refreshTokenHash: MOCK_HASH_2 };
      mockRepository.rotateRefreshToken.mockResolvedValue({
        success: true,
        session: updatedSession,
      });

      const result = await service.rotateSessionToken({
        sessionId: MOCK_SESSION.id,
        currentRefreshTokenHash: MOCK_HASH_1,
        newRefreshTokenHash: MOCK_HASH_2,
        now: MOCK_DATE,
      });

      expect(result.success).toBe(true);
      expect(result.session?.id).toBe(MOCK_SESSION.id);
      expect((result.session as unknown as Record<string, unknown>)?.refreshTokenHash).toBeUndefined();
      expect(result.replayDetected).toBeUndefined();
    });

    it('safely rejects stale or mismatched refresh token without nuking the session', async () => {
      mockRepository.rotateRefreshToken.mockResolvedValue({
        success: false,
        reason: 'TOKEN_MISMATCH',
        session: MOCK_SESSION,
      });

      const result = await service.rotateSessionToken({
        sessionId: MOCK_SESSION.id,
        currentRefreshTokenHash: 'stale-hash',
        newRefreshTokenHash: MOCK_HASH_2,
        now: MOCK_DATE,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('TOKEN_MISMATCH');
      expect(mockRepository.revokeSession).not.toHaveBeenCalled();
    });

    it('handles ordinary rotation failure without emergency revocation', async () => {
      mockRepository.rotateRefreshToken.mockResolvedValue({
        success: false,
        reason: 'SESSION_EXPIRED',
        session: { ...MOCK_SESSION, expiresAt: new Date(MOCK_DATE.getTime() - 1000) },
      });

      const result = await service.rotateSessionToken({
        sessionId: MOCK_SESSION.id,
        currentRefreshTokenHash: MOCK_HASH_1,
        newRefreshTokenHash: MOCK_HASH_2,
        now: MOCK_DATE,
      });

      expect(result.success).toBe(false);
      expect(result.replayDetected).toBe(false);
      expect(mockRepository.revokeSession).not.toHaveBeenCalled();
    });
  });

  // ── revokeSession & revokeAllUserSessions ──────────────────────────────────

  describe('revocation operations', () => {
    it('revokes a single session with default reason', async () => {
      mockRepository.revokeSession.mockResolvedValue(true);

      const res = await service.revokeSession(MOCK_SESSION.id, 'USER_LOGOUT', MOCK_DATE);
      expect(res).toBe(true);
      expect(mockRepository.revokeSession).toHaveBeenCalledWith(
        MOCK_SESSION.id,
        MOCK_DATE,
        'USER_LOGOUT',
      );
    });

    it('revokes all user sessions with optional exclusion', async () => {
      mockRepository.revokeAllUserSessions.mockResolvedValue(2);

      const count = await service.revokeAllUserSessions(
        MOCK_SESSION.userId,
        'USER_LOGOUT_ALL',
        'current-session-id',
        MOCK_DATE,
      );

      expect(count).toBe(2);
      expect(mockRepository.revokeAllUserSessions).toHaveBeenCalledWith(
        MOCK_SESSION.userId,
        MOCK_DATE,
        'USER_LOGOUT_ALL',
        'current-session-id',
      );
    });
  });

  // ── listUserSessions ───────────────────────────────────────────────────────

  describe('listUserSessions', () => {
    it('returns mapped sessions and sets isCurrent for the active session', async () => {
      const otherId = '33333333-3333-3333-3333-333333333333';
      mockRepository.listUserSessions.mockResolvedValue([
        {
          id: MOCK_SESSION.id,
          userId: MOCK_SESSION.userId,
          rememberMe: false,
          createdAt: MOCK_DATE,
          lastSeenAt: null,
          expiresAt: MOCK_EXPIRY,
          revokedAt: null,
          userAgent: 'Browser 1',
          ipAddress: '1.1.1.1',
        },
        {
          id: otherId,
          userId: MOCK_SESSION.userId,
          rememberMe: true,
          createdAt: MOCK_DATE,
          lastSeenAt: null,
          expiresAt: MOCK_EXPIRY,
          revokedAt: null,
          userAgent: 'Browser 2',
          ipAddress: '2.2.2.2',
        },
      ]);

      const list = await service.listUserSessions(MOCK_SESSION.userId, MOCK_SESSION.id);
      expect(list.length).toBe(2);
      expect(list[0]?.isCurrent).toBe(true);
      expect(list[1]?.isCurrent).toBe(false);
      expect((list[0] as unknown as Record<string, unknown>).refreshTokenHash).toBeUndefined();
    });
  });

  describe('revokeUserSession', () => {
    it('delegates to repository.revokeUserSession and returns boolean', async () => {
      mockRepository.revokeUserSession.mockResolvedValue(true);

      const result = await service.revokeUserSession(
        MOCK_SESSION.id,
        MOCK_SESSION.userId,
        'USER_LOGOUT',
        MOCK_DATE,
      );

      expect(result).toBe(true);
      expect(mockRepository.revokeUserSession).toHaveBeenCalledWith(
        MOCK_SESSION.id,
        MOCK_SESSION.userId,
        MOCK_DATE,
        'USER_LOGOUT',
      );
    });
  });

  describe('listActiveUserSessions', () => {
    it('maps active sessions from repository with isCurrent boolean', async () => {
      const otherId = '33333333-3333-3333-3333-333333333333';
      mockRepository.listActiveUserSessions.mockResolvedValue([
        {
          id: MOCK_SESSION.id,
          userId: MOCK_SESSION.userId,
          rememberMe: false,
          createdAt: MOCK_DATE,
          lastSeenAt: null,
          expiresAt: MOCK_EXPIRY,
          revokedAt: null,
          userAgent: 'Browser 1',
          ipAddress: '1.1.1.1',
        },
        {
          id: otherId,
          userId: MOCK_SESSION.userId,
          rememberMe: true,
          createdAt: MOCK_DATE,
          lastSeenAt: null,
          expiresAt: MOCK_EXPIRY,
          revokedAt: null,
          userAgent: 'Browser 2',
          ipAddress: '2.2.2.2',
        },
      ]);

      const list = await service.listActiveUserSessions(
        MOCK_SESSION.userId,
        MOCK_SESSION.id,
        MOCK_DATE,
      );

      expect(list.length).toBe(2);
      expect(list[0]?.isCurrent).toBe(true);
      expect(list[1]?.isCurrent).toBe(false);
      expect((list[0] as unknown as Record<string, unknown>).refreshTokenHash).toBeUndefined();
    });
  });
});
