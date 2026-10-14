import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../../modules/auth/types/jwt.types.js';

export interface OwnershipAssertionOptions {
  /**
   * When true, an authenticated user with ADMIN role is permitted
   * to access or mutate the resource regardless of owner ID.
   * Defaults to false (explicit, audited override only).
   */
  allowAdminOverride?: boolean;

  /**
   * Custom error message for ownership mismatch.
   */
  errorMessage?: string;
}

/**
 * ResourceOwnershipPolicy defines reusable domain rules for user-owned resources (e.g. articles).
 *
 * Requirements:
 * - Route parameters and body-supplied user IDs cannot override the authenticated user context.
 * - Non-owners cannot edit, delete, or mutate another user's resource without explicit elevated permission.
 * - Admin overrides must be deliberate, controlled, and explicitly opted into.
 * - Operates entirely on trusted in-memory UUIDs; does not query premature database tables.
 */
export class ResourceOwnershipPolicy {
  /**
   * Asserts that the authenticated user owns the resource identified by resourceOwnerId.
   *
   * @throws UnauthorizedException if authenticated user context is missing.
   * @throws ForbiddenException if user is not the owner (and admin override is not enabled/applicable).
   */
  static assertOwnership(
    authenticatedUser: AuthenticatedUser | null | undefined,
    resourceOwnerId: string,
    options: OwnershipAssertionOptions = {},
  ): void {
    if (!authenticatedUser) {
      throw new UnauthorizedException('Authentication required.');
    }

    if (!resourceOwnerId) {
      throw new ForbiddenException('Invalid resource owner identifier.');
    }

    if (options.allowAdminOverride && authenticatedUser.role === UserRole.ADMIN) {
      return;
    }

    if (authenticatedUser.id !== resourceOwnerId) {
      throw new ForbiddenException(
        options.errorMessage ?? 'You do not have permission to access or modify this resource.',
      );
    }
  }

  /**
   * Pure boolean evaluation checking if the authenticated user owns the resource.
   */
  static isOwner(
    authenticatedUser: AuthenticatedUser | null | undefined,
    resourceOwnerId: string,
    options: OwnershipAssertionOptions = {},
  ): boolean {
    if (!authenticatedUser || !resourceOwnerId) {
      return false;
    }

    if (options.allowAdminOverride && authenticatedUser.role === UserRole.ADMIN) {
      return true;
    }

    return authenticatedUser.id === resourceOwnerId;
  }
}
