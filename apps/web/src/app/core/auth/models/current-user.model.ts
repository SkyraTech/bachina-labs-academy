import { UserRole, UserStatus } from './login-response.model';

/**
 * Contract for GET /api/v1/auth/me (200 OK).
 */
export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly emailVerifiedAt: string | Date | null;
}
