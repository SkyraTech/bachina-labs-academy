import { ApiProperty } from '@nestjs/swagger';

/**
 * VerifyEmailResponseDto — shape of a successful POST /api/v1/auth/verify-email.
 *
 * Rules:
 *   - Deliberately minimal. It carries no user record, no token, no hash and no
 *     timestamp that could leak account state to a caller who only holds a link.
 *   - The client learns nothing about the account beyond "this link worked".
 *     Anything more (role, status, profile) belongs behind authentication in a
 *     later phase, not in an unauthenticated verification response.
 *   - `verified` is always true. It exists so the client can branch on an
 *     explicit field rather than treating "200 with an empty body" as success.
 */
export class VerifyEmailResponseDto {
  @ApiProperty({
    description:
      'Always true. The presented token was valid, single-use and unexpired, ' +
      'and the account email is now marked verified.',
    example: true,
  })
  verified!: boolean;

  @ApiProperty({
    description:
      'Human-readable confirmation message. Safe to display directly to the user.',
    example: 'Your email address has been verified.',
  })
  message!: string;
}
