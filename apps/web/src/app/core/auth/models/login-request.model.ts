/**
 * Payload contract for POST /api/v1/auth/login.
 */
export interface LoginRequest {
  readonly email: string;
  readonly password: string;
  readonly rememberMe?: boolean;
}
