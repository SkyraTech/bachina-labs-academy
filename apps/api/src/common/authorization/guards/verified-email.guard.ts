import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../../modules/auth/types/jwt.types.js';
import { AccountEligibilityPolicy } from '../policies/account-eligibility.policy.js';

/**
 * VerifiedEmailGuard ensures that the authenticated user has verified their email address.
 * Reads strictly from the trusted request.user attached by JwtAccessGuard (no redundant DB query).
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }

    AccountEligibilityPolicy.assertEmailVerified(user);
    return true;
  }
}
