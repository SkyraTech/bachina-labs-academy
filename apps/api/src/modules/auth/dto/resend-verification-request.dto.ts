import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * ResendVerificationRequestDto — validated body for POST /api/v1/auth/resend-verification.
 *
 * Security rules enforced here:
 *   - Only `email` is accepted. Extra fields are rejected by the global
 *     ValidationPipe (whitelist + forbidNonWhitelisted).
 *   - Email is normalized (trimmed + lowercased) at the transform layer, matching
 *     RegisterRequestDto, so the lookup aligns with the users_email_key index and
 *     the LOWER(email) uniqueness guarantee.
 *   - The response never depends on whether the address exists. Validation
 *     failures (400) are distinct from the uniform success response (202) because
 *     a malformed address cannot be an account oracle — an attacker already knows
 *     whether the string they typed is a valid email.
 *
 * Enumeration resistance lives in EmailVerificationService.resendVerification(),
 * which collapses unknown / verified / cooldown / transport-failure into one
 * indistinguishable response.
 */
export class ResendVerificationRequestDto {
  @ApiProperty({
    description:
      'Account email address to resend verification for. Normalized to lowercase.',
    example: 'alice@example.com',
    maxLength: 254,
  })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsString({ message: 'email must be a string' })
  @MaxLength(254, {
    message: 'email must not exceed 254 characters',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;
}
