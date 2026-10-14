import { UserRole, UserStatus } from '@prisma/client';

/**
 * SafeUser — a typed representation of a User record with the password hash
 * explicitly excluded. This type is safe to pass through application layers
 * and return in internal service responses.
 *
 * Rules:
 *   - Never include passwordHash in this type.
 *   - Use this type for any value that may be logged, serialized, or returned
 *     from a service method that other modules can call.
 *   - The repository returns this type from all public-facing query methods.
 */
export interface SafeUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * UserLookupResult — the result of a single-user lookup operation.
 *
 * null  — the user does not exist.
 * SafeUser — the user was found; password hash is not present.
 */
export type UserLookupResult = SafeUser | null;

/**
 * CreateUserInput — the minimal, trusted set of fields accepted by the
 * persistence layer when inserting a new user record.
 *
 * Security rules:
 *   - role and status are NOT included — they are assigned by Prisma model
 *     defaults (AUTHOR and ACTIVE respectively). Client-supplied values are
 *     never accepted.
 *   - emailVerifiedAt is NOT included — always null at creation. Verification
 *     is set by a separate, authenticated workflow (Step 2.2.3).
 *   - id is NOT included — PostgreSQL generates it via gen_random_uuid().
 *   - passwordHash is the already-hashed value from PasswordHashingService.
 *     The repository MUST NOT receive or log plaintext passwords.
 */
export interface CreateUserInput {
  email: string;
  passwordHash: string;
}

export { UserRole, UserStatus };
