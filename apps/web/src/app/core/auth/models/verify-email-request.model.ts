/**
 * Payload contract for POST /api/v1/auth/verify-email.
 * Contains single-use 43-character base64url verification token.
 */
export interface VerifyEmailRequest {
  readonly token: string;
}
