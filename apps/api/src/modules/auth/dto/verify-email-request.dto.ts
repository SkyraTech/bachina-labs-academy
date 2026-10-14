import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * VerifyEmailRequestDto — validated request body for POST /api/v1/auth/verify-email.
 *
 * Security rules enforced here:
 *   - Only `token` is accepted. Extra fields are rejected by the global
 *     ValidationPipe (whitelist + forbidNonWhitelisted).
 *   - The token is validated by shape only. Validity is decided by the
 *     database lookup, which is why an unknown token and an expired token
 *     produce the identical 400 — see EmailVerificationService.
 *   - The value is never trimmed or lowercased: raw tokens are case-sensitive
 *     base64url, and normalizing would corrupt them.
 *
 * Token shape: VerificationTokenService issues 32 random bytes as base64url,
 * which is exactly 43 characters from [A-Za-z0-9_-]. The length bounds below
 * reject obviously malformed input before it reaches the database, without
 * encoding the hash or any secret.
 */
export class VerifyEmailRequestDto {
  @ApiProperty({
    description:
      'Single-use verification token exactly as delivered in the verification email. ' +
      'Case-sensitive; do not modify or URL-decode.',
    example: 'b3JpZ2luYWwtdG9rZW4tdmFsdWUtNQ',
    minLength: 43,
    maxLength: 43,
  })
  @IsString({ message: 'token must be a string' })
  @MinLength(43, { message: 'token must be exactly 43 characters' })
  @MaxLength(43, { message: 'token must be exactly 43 characters' })
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'token must be a valid base64url verification token',
  })
  token!: string;
}
