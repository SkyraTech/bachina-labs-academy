import { describe, it, expect } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { ResourceOwnershipPolicy } from './resource-ownership.policy.js';
import type { AuthenticatedUser } from '../../../modules/auth/types/jwt.types.js';

describe('ResourceOwnershipPolicy', () => {
  const authorUser: AuthenticatedUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'author@example.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    sessionId: '22222222-2222-2222-2222-222222222222',
  };

  const adminUser: AuthenticatedUser = {
    id: '99999999-9999-9999-9999-999999999999',
    email: 'admin@example.com',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    sessionId: '33333333-3333-3333-3333-333333333333',
  };

  const otherUserUuid = '55555555-5555-5555-5555-555555555555';

  describe('assertOwnership', () => {
    it('passes when authenticated user ID matches the resource owner ID', () => {
      expect(() =>
        ResourceOwnershipPolicy.assertOwnership(authorUser, authorUser.id),
      ).not.toThrow();
    });

    it('throws ForbiddenException when authenticated user ID does not match resource owner ID', () => {
      expect(() =>
        ResourceOwnershipPolicy.assertOwnership(authorUser, otherUserUuid),
      ).toThrow(ForbiddenException);
      expect(() =>
        ResourceOwnershipPolicy.assertOwnership(authorUser, otherUserUuid),
      ).toThrow('You do not have permission to access or modify this resource.');
    });

    it('throws UnauthorizedException when user context is null', () => {
      expect(() =>
        ResourceOwnershipPolicy.assertOwnership(null, otherUserUuid),
      ).toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException if resource owner ID is empty or invalid', () => {
      expect(() =>
        ResourceOwnershipPolicy.assertOwnership(authorUser, ''),
      ).toThrow(ForbiddenException);
    });

    it('denies ADMIN if allowAdminOverride is not set (default false)', () => {
      expect(() =>
        ResourceOwnershipPolicy.assertOwnership(adminUser, authorUser.id),
      ).toThrow(ForbiddenException);
    });

    it('permits ADMIN when allowAdminOverride is explicitly true', () => {
      expect(() =>
        ResourceOwnershipPolicy.assertOwnership(adminUser, authorUser.id, {
          allowAdminOverride: true,
        }),
      ).not.toThrow();
    });

    it('still denies non-ADMIN even if allowAdminOverride is true', () => {
      expect(() =>
        ResourceOwnershipPolicy.assertOwnership(authorUser, otherUserUuid, {
          allowAdminOverride: true,
        }),
      ).toThrow(ForbiddenException);
    });
  });

  describe('isOwner', () => {
    it('returns true when user ID matches resource owner ID', () => {
      expect(ResourceOwnershipPolicy.isOwner(authorUser, authorUser.id)).toBe(true);
    });

    it('returns false when user ID does not match resource owner ID', () => {
      expect(ResourceOwnershipPolicy.isOwner(authorUser, otherUserUuid)).toBe(false);
    });

    it('returns true for ADMIN when allowAdminOverride is true', () => {
      expect(
        ResourceOwnershipPolicy.isOwner(adminUser, otherUserUuid, {
          allowAdminOverride: true,
        }),
      ).toBe(true);
    });

    it('returns false for ADMIN when allowAdminOverride is false', () => {
      expect(ResourceOwnershipPolicy.isOwner(adminUser, otherUserUuid)).toBe(false);
    });

    it('returns false if user context is missing', () => {
      expect(ResourceOwnershipPolicy.isOwner(null, otherUserUuid)).toBe(false);
    });
  });
});
