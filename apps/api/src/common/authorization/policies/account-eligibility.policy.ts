import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../../modules/auth/types/jwt.types.js';

/**
 * AccountEligibilityPolicy enforces account status and email verification rules
 * using trusted, server-resolved user context.
 *
 * Rules:
 * - Does not accept client-provided flags or DTOs.
 * - Does not perform duplicate database queries; evaluates already verified user state.
 * - Enforces explicit separation between account status (ACTIVE) and email verification.
 */
export class AccountEligibilityPolicy {
  /**
   * Asserts that an account is in ACTIVE status.
   * Throws UnauthorizedException if account is SUSPENDED, DISABLED, or absent.
   */
  static assertActive(user: Pick<AuthenticatedUser, 'status'> | null | undefined): void {
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active.');
    }
  }

  /**
   * Asserts that an account has completed email verification.
   * Throws ForbiddenException if email is not verified.
   */
  static assertEmailVerified(user: Pick<AuthenticatedUser, 'emailVerifiedAt'> | null | undefined): void {
    if (!user || !user.emailVerifiedAt) {
      throw new ForbiddenException('Email verification required.');
    }
  }

  /**
   * Asserts that the authenticated user meets all base account eligibility criteria:
   * 1. Present authenticated user context.
   * 2. Account status is ACTIVE.
   * 3. Email verification is completed.
   */
  static assertEligible(user: AuthenticatedUser | null | undefined): asserts user is AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }
    this.assertActive(user);
    this.assertEmailVerified(user);
  }
}
