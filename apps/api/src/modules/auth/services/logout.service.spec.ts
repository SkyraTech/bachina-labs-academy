import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { LogoutService } from './logout.service.js';
import type { AuthenticatedUser } from '../types/jwt.types.js';

describe('LogoutService', () => {
  let service: LogoutService;
  let sessionsRepositoryMock: any;
  let sessionsServiceMock: any;
  let jwtTokenServiceMock: any;
  let refreshTokenServiceMock: any;
  let cookieServiceMock: any;

  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'user@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    sessionId: 'session-current-uuid',
  };

  beforeEach(() => {
    sessionsRepositoryMock = {
      findById: vi.fn(),
      findByRefreshTokenHash: vi.fn(),
    };
    sessionsServiceMock = {
      revokeSession: vi.fn().mockResolvedValue(true),
      revokeAllUserSessions: vi.fn().mockResolvedValue(3),
      listActiveUserSessions: vi.fn().mockResolvedValue([]),
      revokeUserSession: vi.fn().mockResolvedValue(true),
    };
    jwtTokenServiceMock = {
      verifyAccessToken: vi.fn(),
    };
    refreshTokenServiceMock = {
      hashRefreshToken: vi.fn((token: string) => `hash-${token}`),
    };
    cookieServiceMock = {
      clearAuthCookies: vi.fn(),
    };

    service = new LogoutService(
      sessionsRepositoryMock,
      sessionsServiceMock,
      jwtTokenServiceMock,
      refreshTokenServiceMock,
      cookieServiceMock,
    );
  });

  describe('logout()', () => {
    it('revokes session identified by valid access JWT cookie and clears cookies', async () => {
      jwtTokenServiceMock.verifyAccessToken.mockResolvedValue({
        sub: mockUser.id,
        sid: 'session-jwt-123',
      });
      sessionsRepositoryMock.findById.mockResolvedValue({
        id: 'session-jwt-123',
        revokedAt: null,
      });

      const req = {
        cookies: { academy_access: 'valid-access-token' },
      } as any;
      const res = {} as any;

      const result = await service.logout(req, res);

      expect(sessionsServiceMock.revokeSession).toHaveBeenCalledWith(
        'session-jwt-123',
        'USER_LOGOUT',
      );
      expect(cookieServiceMock.clearAuthCookies).toHaveBeenCalledWith(res);
      expect(result.message).toBe('Logged out successfully.');
    });

    it('falls back to refresh cookie when access JWT is expired and revokes active session', async () => {
      jwtTokenServiceMock.verifyAccessToken.mockRejectedValue(
        new Error('TokenExpiredError'),
      );
      sessionsRepositoryMock.findByRefreshTokenHash.mockResolvedValue({
        id: 'session-refresh-456',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      });

      const req = {
        cookies: {
          academy_access: 'expired-access-token',
          academy_refresh: 'valid-raw-refresh-token',
        },
      } as any;
      const res = {} as any;

      const result = await service.logout(req, res);

      expect(refreshTokenServiceMock.hashRefreshToken).toHaveBeenCalledWith(
        'valid-raw-refresh-token',
      );
      expect(sessionsServiceMock.revokeSession).toHaveBeenCalledWith(
        'session-refresh-456',
        'USER_LOGOUT',
      );
      expect(cookieServiceMock.clearAuthCookies).toHaveBeenCalledWith(res);
      expect(result.message).toBe('Logged out successfully.');
    });

    it('works when access JWT is missing but refresh cookie is present', async () => {
      sessionsRepositoryMock.findByRefreshTokenHash.mockResolvedValue({
        id: 'session-refresh-789',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      });

      const req = {
        cookies: {
          academy_refresh: 'valid-raw-refresh-token',
        },
      } as any;
      const res = {} as any;

      const result = await service.logout(req, res);

      expect(sessionsServiceMock.revokeSession).toHaveBeenCalledWith(
        'session-refresh-789',
        'USER_LOGOUT',
      );
      expect(cookieServiceMock.clearAuthCookies).toHaveBeenCalledWith(res);
      expect(result.message).toBe('Logged out successfully.');
    });

    it('clears cookies and returns success idempotently when credentials are absent or invalid', async () => {
      const req = { cookies: {} } as any;
      const res = {} as any;

      const result = await service.logout(req, res);

      expect(sessionsServiceMock.revokeSession).not.toHaveBeenCalled();
      expect(cookieServiceMock.clearAuthCookies).toHaveBeenCalledWith(res);
      expect(result.message).toBe('Logged out successfully.');
    });
  });

  describe('logoutAll()', () => {
    it('revokes all sessions for authenticated user and clears current cookies', async () => {
      const res = {} as any;

      const result = await service.logoutAll(mockUser, res);

      expect(sessionsServiceMock.revokeAllUserSessions).toHaveBeenCalledWith(
        mockUser.id,
        'USER_LOGOUT_ALL',
      );
      expect(cookieServiceMock.clearAuthCookies).toHaveBeenCalledWith(res);
      expect(result.revokedCount).toBe(3);
      expect(result.message).toBe('All sessions logged out successfully.');
    });
  });

  describe('getActiveSessions()', () => {
    it('retrieves active sessions and maps isCurrent correctly', async () => {
      const now = new Date();
      sessionsServiceMock.listActiveUserSessions.mockResolvedValue([
        {
          id: mockUser.sessionId,
          userId: mockUser.id,
          rememberMe: true,
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + 100000),
          revokedAt: null,
          userAgent: 'Test Agent',
          ipAddress: '127.0.0.1',
          isCurrent: true,
        },
        {
          id: 'other-session-uuid',
          userId: mockUser.id,
          rememberMe: false,
          createdAt: now,
          lastSeenAt: null,
          expiresAt: new Date(now.getTime() + 50000),
          revokedAt: null,
          userAgent: 'Mobile Agent',
          ipAddress: '10.0.0.1',
          isCurrent: false,
        },
      ]);

      const result = await service.getActiveSessions(mockUser);

      expect(sessionsServiceMock.listActiveUserSessions).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.sessionId,
      );
      expect(result.length).toBe(2);
      expect(result[0].isCurrent).toBe(true);
      expect(result[1].isCurrent).toBe(false);
      expect(result[0]).not.toHaveProperty('refreshTokenHash');
    });
  });

  describe('revokeSession()', () => {
    it('revokes designated session and clears cookies if it is the current session', async () => {
      sessionsServiceMock.revokeUserSession.mockResolvedValue(true);
      const res = {} as any;

      const result = await service.revokeSession(mockUser.sessionId, mockUser, res);

      expect(sessionsServiceMock.revokeUserSession).toHaveBeenCalledWith(
        mockUser.sessionId,
        mockUser.id,
        'USER_LOGOUT',
      );
      expect(cookieServiceMock.clearAuthCookies).toHaveBeenCalledWith(res);
      expect(result.isCurrentSession).toBe(true);
      expect(result.message).toBe('Session revoked successfully.');
    });

    it('revokes designated session and preserves cookies if it is another device', async () => {
      sessionsServiceMock.revokeUserSession.mockResolvedValue(true);
      const res = {} as any;

      const result = await service.revokeSession('other-device-uuid', mockUser, res);

      expect(sessionsServiceMock.revokeUserSession).toHaveBeenCalledWith(
        'other-device-uuid',
        mockUser.id,
        'USER_LOGOUT',
      );
      expect(cookieServiceMock.clearAuthCookies).not.toHaveBeenCalled();
      expect(result.isCurrentSession).toBe(false);
      expect(result.message).toBe('Session revoked successfully.');
    });

    it('throws NotFoundException non-enumerating error if session is not found or not owned', async () => {
      sessionsServiceMock.revokeUserSession.mockResolvedValue(false);
      const res = {} as any;

      await expect(
        service.revokeSession('unowned-uuid', mockUser, res),
      ).rejects.toThrow(NotFoundException);
      expect(cookieServiceMock.clearAuthCookies).not.toHaveBeenCalled();
    });
  });
});
