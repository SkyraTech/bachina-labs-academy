import { describe, it, expect } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { AccountEligibilityPolicy } from './account-eligibility.policy.js';
import type { AuthenticatedUser } from '../../../modules/auth/types/jwt.types.js';

describe('AccountEligibilityPolicy', () => {
  const validUser: AuthenticatedUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'test@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    sessionId: '22222222-2222-2222-2222-222222222222',
  };

  describe('assertActive', () => {
    it('passes for an ACTIVE user', () => {
      expect(() => AccountEligibilityPolicy.assertActive(validUser)).not.toThrow();
    });

    it('throws UnauthorizedException for a SUSPENDED user', () => {
      expect(() =>
        AccountEligibilityPolicy.assertActive({ ...validUser, status: UserStatus.SUSPENDED }),
      ).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a DISABLED user', () => {
      expect(() =>
        AccountEligibilityPolicy.assertActive({ ...validUser, status: UserStatus.DISABLED }),
      ).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if user context is missing or null', () => {
      expect(() => AccountEligibilityPolicy.assertActive(null)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('assertEmailVerified', () => {
    it('passes when emailVerifiedAt is set', () => {
      expect(() => AccountEligibilityPolicy.assertEmailVerified(validUser)).not.toThrow();
    });

    it('throws ForbiddenException when emailVerifiedAt is null', () => {
      expect(() =>
        AccountEligibilityPolicy.assertEmailVerified({ ...validUser, emailVerifiedAt: null }),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when user context is null', () => {
      expect(() => AccountEligibilityPolicy.assertEmailVerified(null)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('assertEligible', () => {
    it('passes for an ACTIVE, email-verified user', () => {
      expect(() => AccountEligibilityPolicy.assertEligible(validUser)).not.toThrow();
    });

    it('throws UnauthorizedException if user is null', () => {
      expect(() => AccountEligibilityPolicy.assertEligible(null)).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException if user is SUSPENDED despite verified email', () => {
      expect(() =>
        AccountEligibilityPolicy.assertEligible({
          ...validUser,
          status: UserStatus.SUSPENDED,
        }),
      ).toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException if user is ACTIVE but email is not verified', () => {
      expect(() =>
        AccountEligibilityPolicy.assertEligible({
          ...validUser,
          emailVerifiedAt: null,
        }),
      ).toThrow(ForbiddenException);
    });
  });
});
