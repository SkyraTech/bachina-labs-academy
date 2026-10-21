/**
 * Payload contract for POST /api/v1/auth/register.
 */
export interface RegisterRequest {
  readonly email: string;
  readonly password: string;
}
