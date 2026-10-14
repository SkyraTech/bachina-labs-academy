import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { IS_PUBLIC_KEY } from '../../../modules/auth/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../../../modules/auth/types/jwt.types.js';

/**
 * RolesGuard enforces role-based access control (RBAC) across handlers and controllers.
 *
 * Security & Execution Order:
 * 1. Registered as global APP_GUARD immediately following JwtAccessGuard.
 * 2. Checks for contradictory configuration (@Public() + @Roles()):
 *    Detects and rejects as an application configuration error with 403 Forbidden.
 * 3. If no role metadata is present, access is permitted (JwtAccessGuard still handles authentication).
 * 4. If role metadata is present, requires trusted request.user context resolved by JwtAccessGuard.
 * 5. Compares server-resolved user.role against required roles.
 * 6. Rejects insufficient role or missing user with 403 Forbidden without leaking sensitive internals.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Resolve role requirements (handler overrides controller)
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 2. Resolve public route metadata
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 3. Contradictory metadata policy:
    // If an endpoint resolves both @Public() and @Roles(), fail-closed with 403 Forbidden.
    if (isPublic && requiredRoles && requiredRoles.length > 0) {
      this.logger.error(
        `Contradictory route configuration: @Public() cannot be combined with role restrictions [${requiredRoles.join(
          ', ',
        )}]. Endpoint will fail-closed.`,
      );
      throw new ForbiddenException(
        'Invalid route configuration: @Public() cannot be combined with role restrictions.',
      );
    }

    // 4. If no role restrictions are defined, allow request to proceed
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // 5. If roles are required, ensure valid server-resolved user context is present
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      this.logger.warn('Role-protected route accessed without authenticated user context.');
      throw new ForbiddenException('Insufficient permissions.');
    }

    // 6. Verify server-resolved role against allowed roles
    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      this.logger.warn(
        `User ${user.id} with role ${user.role} denied access to route requiring [${requiredRoles.join(
          ', ',
        )}]`,
      );
      throw new ForbiddenException('Insufficient permissions.');
    }

    return true;
  }
}
