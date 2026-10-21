/**
 * Payload contract for POST /api/v1/auth/resend-verification.
 */
export interface ResendVerificationRequest {
  readonly email: string;
}
