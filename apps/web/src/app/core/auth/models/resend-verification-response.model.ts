/**
 * Response contract for POST /api/v1/auth/resend-verification (202 Accepted).
 * Uniform response preventing email enumeration.
 */
export interface ResendVerificationResponse {
  readonly status: number;
  readonly message: string;
}
