import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { VerifiedEmailGuard } from './verified-email.guard.js';
import type { AuthenticatedUser } from '../../../modules/auth/types/jwt.types.js';

describe('VerifiedEmailGuard', () => {
  let guard: VerifiedEmailGuard;

  const mockUser = (emailVerifiedAt: Date | null = new Date()): AuthenticatedUser => ({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'user@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt,
    sessionId: '22222222-2222-2222-2222-222222222222',
  });

  const createMockContext = (user?: AuthenticatedUser): ExecutionContext => {
    const mockRequest = { user };
    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    guard = new VerifiedEmailGuard();
  });

  it('permits access when user has a valid emailVerifiedAt date', () => {
    const context = createMockContext(mockUser(new Date('2026-01-01')));
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies access with 403 Forbidden when emailVerifiedAt is null', () => {
    const context = createMockContext(mockUser(null));
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow('Email verification required.');
  });

  it('denies access with 401 Unauthorized when request user context is missing', () => {
    const context = createMockContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Authentication required.');
  });
});
