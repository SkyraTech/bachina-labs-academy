/**
 * Response contract for POST /api/v1/auth/verify-email (200 OK).
 */
export interface VerifyEmailResponse {
  readonly verified: boolean;
  readonly message: string;
}
