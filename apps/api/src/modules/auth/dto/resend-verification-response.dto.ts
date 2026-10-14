import { ApiProperty } from '@nestjs/swagger';

/**
 * ResendVerificationResponseDto — shape of POST /api/v1/auth/resend-verification.
 *
 * Security: uniform response, always
 * ───────────────────────────────────
 * This DTO is returned VERBATIM for every well-formed request, regardless of
 * whether the address belongs to an account, the account is already verified, a
 * cooldown is active, or the mail transport failed. The internal outcome is
 * logged server-side only.
 *
 * Returning a constant body is what denies account enumeration. If the response
 * varied — "account not found" vs "email sent", or a faster response for unknown
 * addresses — an attacker could grind through a wordlist of addresses and learn
 * exactly which ones are registered here. The status code is likewise constant
 * (202 Accepted) for all of those branches, so timing and status cannot be used
 * as a side channel either.
 *
 * Note the deliberate asymmetry with validation: a malformed address still gets
 * 400. That is safe because a caller who types an invalid email already knows
 * their own input is invalid — it discloses nothing about the account database.
 */
export class ResendVerificationResponseDto {
  @ApiProperty({
    description:
      'Always 202 Accepted for a well-formed request. Identical whether or not ' +
      'an account exists for the address.',
    example: 202,
  })
  status!: number;

  @ApiProperty({
    description:
      'Generic, non-committal confirmation. Does not confirm whether an email was sent.',
    example:
      'If an account exists for that address, a verification email has been sent.',
  })
  message!: string;
}
