import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JwtAccessGuard } from './jwt-access.guard';
import { JwtTokenService } from '../services/jwt-token.service';
import { SessionsService } from '../../sessions/sessions.service';
import { UsersRepository } from '../../users/users.repository';
import { ACCESS_COOKIE_NAME } from '../services/cookie.service';
import type { AccessTokenPayload } from '../types/jwt.types';

describe('JwtAccessGuard', () => {
  let guard: JwtAccessGuard;
  let reflector: {
    getAllAndOverride: ReturnType<typeof vi.fn>;
  };
  let jwtTokenService: {
    verifyAccessToken: ReturnType<typeof vi.fn>;
  };
  let sessionsService: {
    validateSession: ReturnType<typeof vi.fn>;
  };
  let usersRepository: {
    findById: ReturnType<typeof vi.fn>;
  };

  const mockPayload: AccessTokenPayload = {
    sub: '11111111-1111-1111-1111-111111111111',
    sid: '22222222-2222-2222-2222-222222222222',
    jti: '33333333-3333-3333-3333-333333333333',
    iss: 'bachina-labs-academy',
    aud: 'bachina-labs-academy-web',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };

  const mockSession = {
    id: mockPayload.sid,
    userId: mockPayload.sub,
    refreshTokenHash: 'hash',
    userAgent: null,
    ipAddress: null,
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
    revocationReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSeenAt: new Date(),
  };

  const mockUser = {
    id: mockPayload.sub,
    email: 'test@skyra-tech.com',
    role: 'AUTHOR' as const,
    status: 'ACTIVE' as const,
    emailVerifiedAt: new Date('2026-10-14T12:00:00.000Z'),
    displayName: 'Test User',
    avatarUrl: null,
    bio: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    suspendedAt: null,
    deletedAt: null,
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: vi.fn(),
    };

    jwtTokenService = {
      verifyAccessToken: vi.fn(),
    };

    sessionsService = {
      validateSession: vi.fn(),
    };

    usersRepository = {
      findById: vi.fn(),
    };

    guard = new JwtAccessGuard(
      reflector as unknown as Reflector,
      jwtTokenService as unknown as JwtTokenService,
      sessionsService as unknown as SessionsService,
      usersRepository as unknown as UsersRepository,
    );
  });

  function createMockContext(
    requestOverrides: Record<string, unknown> = {},
  ): { context: ExecutionContext; request: Record<string, unknown> } {
    const request = {
      method: 'GET',
      cookies: {},
      headers: {},
      ...requestOverrides,
    };

    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue(request),
      }),
    } as unknown as ExecutionContext;

    return { context, request };
  }

  it('allows access if route is decorated with @Public()', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context } = createMockContext();

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(jwtTokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('allows access for OPTIONS preflight requests', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const { context } = createMockContext({ method: 'OPTIONS' });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(jwtTokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException if no token is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const { context } = createMockContext();

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Authentication required.'),
    );
  });

  it('extracts token from cookie and validates successfully', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const { context, request } = createMockContext({
      cookies: { [ACCESS_COOKIE_NAME]: 'valid-jwt' },
    });

    jwtTokenService.verifyAccessToken.mockResolvedValue(mockPayload);
    sessionsService.validateSession.mockResolvedValue(mockSession);
    usersRepository.findById.mockResolvedValue(mockUser);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(jwtTokenService.verifyAccessToken).toHaveBeenCalledWith('valid-jwt');
    expect(sessionsService.validateSession).toHaveBeenCalledWith(mockPayload.sid);
    expect(usersRepository.findById).toHaveBeenCalledWith(mockPayload.sub);
    expect(request.user).toEqual({
      id: mockUser.id,
      email: mockUser.email,
      role: mockUser.role,
      status: mockUser.status,
      emailVerifiedAt: mockUser.emailVerifiedAt,
      sessionId: mockPayload.sid,
    });
  });

  it('rejects requests that supply only an Authorization Bearer header', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const { context } = createMockContext({
      headers: { authorization: 'Bearer header-jwt' },
      cookies: {},
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Authentication required.'),
    );
    expect(jwtTokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when session is not found or revoked in database', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const { context } = createMockContext({
      cookies: { [ACCESS_COOKIE_NAME]: 'valid-jwt' },
    });

    jwtTokenService.verifyAccessToken.mockResolvedValue(mockPayload);
    sessionsService.validateSession.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Session has expired or was revoked.'),
    );
  });

  it('throws UnauthorizedException when session belongs to a different user', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const { context } = createMockContext({
      cookies: { [ACCESS_COOKIE_NAME]: 'valid-jwt' },
    });

    jwtTokenService.verifyAccessToken.mockResolvedValue(mockPayload);
    sessionsService.validateSession.mockResolvedValue({
      ...mockSession,
      userId: '99999999-9999-9999-9999-999999999999',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid session context.'),
    );
  });

  it('throws UnauthorizedException when user does not exist or status is not ACTIVE', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const { context } = createMockContext({
      cookies: { [ACCESS_COOKIE_NAME]: 'valid-jwt' },
    });

    jwtTokenService.verifyAccessToken.mockResolvedValue(mockPayload);
    sessionsService.validateSession.mockResolvedValue(mockSession);
    usersRepository.findById.mockResolvedValue({
      ...mockUser,
      status: 'SUSPENDED' as const,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Account is not active.'),
    );
  });

  it('throws UnauthorizedException when user email is not verified', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const { context } = createMockContext({
      cookies: { [ACCESS_COOKIE_NAME]: 'valid-jwt' },
    });

    jwtTokenService.verifyAccessToken.mockResolvedValue(mockPayload);
    sessionsService.validateSession.mockResolvedValue(mockSession);
    usersRepository.findById.mockResolvedValue({
      ...mockUser,
      emailVerifiedAt: null,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Email verification required.'),
    );
  });
});
