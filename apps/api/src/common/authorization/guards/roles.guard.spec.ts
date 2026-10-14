import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus } from '@prisma/client';
import { RolesGuard } from './roles.guard.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { IS_PUBLIC_KEY } from '../../../modules/auth/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../../../modules/auth/types/jwt.types.js';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const mockUser = (role: UserRole = UserRole.AUTHOR): AuthenticatedUser => ({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'user@example.com',
    role,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    sessionId: '22222222-2222-2222-2222-222222222222',
  });

  const createMockContext = (
    user: AuthenticatedUser | undefined,
    handler = () => {},
    controllerClass = class TestController {},
  ): ExecutionContext => {
    const mockRequest = { user };
    return {
      getHandler: () => handler,
      getClass: () => controllerClass,
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('permits access when no role metadata exists on handler or controller', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return undefined;
      if (key === IS_PUBLIC_KEY) return undefined;
      return undefined;
    });

    const context = createMockContext(mockUser(UserRole.AUTHOR));
    expect(guard.canActivate(context)).toBe(true);
  });

  it('permits AUTHOR on route requiring AUTHOR role', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return [UserRole.AUTHOR];
      if (key === IS_PUBLIC_KEY) return undefined;
      return undefined;
    });

    const context = createMockContext(mockUser(UserRole.AUTHOR));
    expect(guard.canActivate(context)).toBe(true);
  });

  it('permits ADMIN on route requiring ADMIN role', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return [UserRole.ADMIN];
      if (key === IS_PUBLIC_KEY) return undefined;
      return undefined;
    });

    const context = createMockContext(mockUser(UserRole.ADMIN));
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies AUTHOR on route requiring ADMIN role with 403 Forbidden', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return [UserRole.ADMIN];
      if (key === IS_PUBLIC_KEY) return undefined;
      return undefined;
    });

    const context = createMockContext(mockUser(UserRole.AUTHOR));
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow('Insufficient permissions.');
  });

  it('denies ADMIN on AUTHOR-only route unless explicitly permitted in metadata', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return [UserRole.AUTHOR];
      if (key === IS_PUBLIC_KEY) return undefined;
      return undefined;
    });

    const context = createMockContext(mockUser(UserRole.ADMIN));
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow('Insufficient permissions.');
  });

  it('permits both AUTHOR and ADMIN when multiple roles are allowed', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return [UserRole.AUTHOR, UserRole.ADMIN];
      if (key === IS_PUBLIC_KEY) return undefined;
      return undefined;
    });

    const authorContext = createMockContext(mockUser(UserRole.AUTHOR));
    const adminContext = createMockContext(mockUser(UserRole.ADMIN));

    expect(guard.canActivate(authorContext)).toBe(true);
    expect(guard.canActivate(adminContext)).toBe(true);
  });

  it('denies access with 403 Forbidden when roles are required but user context is missing', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return [UserRole.ADMIN];
      if (key === IS_PUBLIC_KEY) return undefined;
      return undefined;
    });

    const context = createMockContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow('Insufficient permissions.');
  });

  it('rejects contradictory @Public() and @Roles() metadata with 403 Forbidden', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return [UserRole.ADMIN];
      if (key === IS_PUBLIC_KEY) return true;
      return undefined;
    });

    const context = createMockContext(mockUser(UserRole.ADMIN));
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(
      'Invalid route configuration: @Public() cannot be combined with role restrictions.',
    );
  });

  it('permits purely public route when no roles are configured', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return undefined;
      if (key === IS_PUBLIC_KEY) return true;
      return undefined;
    });

    const context = createMockContext(undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('correctly passes handler and class targets to Reflector to support handler-level override', () => {
    const handler = () => {};
    class TestController {}
    const context = createMockContext(mockUser(UserRole.ADMIN), handler, TestController);

    const spy = vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return [UserRole.ADMIN];
      if (key === IS_PUBLIC_KEY) return undefined;
      return undefined;
    });

    guard.canActivate(context);

    expect(spy).toHaveBeenCalledWith(ROLES_KEY, [handler, TestController]);
    expect(spy).toHaveBeenCalledWith(IS_PUBLIC_KEY, [handler, TestController]);
  });
});
