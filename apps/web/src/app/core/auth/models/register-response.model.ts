import { UserRole, UserStatus } from './login-response.model';

/**
 * Response contract for POST /api/v1/auth/register (201 Created).
 * Safe public representation of newly registered account. No session/cookies issued yet.
 */
export interface RegisterResponse {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly emailVerifiedAt: string | Date | null;
  readonly createdAt: string | Date;
  readonly updatedAt: string | Date;
}
