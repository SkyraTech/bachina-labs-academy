export type UserRole = 'ADMIN' | 'EDITOR' | 'AUTHOR' | 'READER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface LoginUser {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly emailVerifiedAt: string | Date | null;
}

/**
 * Response contract for POST /api/v1/auth/login.
 * Authentication tokens (academy_access, academy_refresh) are delivered in secure HttpOnly cookies.
 */
export interface LoginResponse {
  readonly message: string;
  readonly user: LoginUser;
}
