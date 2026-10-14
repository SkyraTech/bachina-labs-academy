import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';

/**
 * RegisterResponseDto — the shape of a successful registration response.
 *
 * Rules:
 *   - NEVER include passwordHash or any credential material.
 *   - This is an explicit contract type, separate from Prisma model types.
 *   - emailVerifiedAt will always be null at registration time.
 *   - The response does NOT include a session or access token.
 *     The user must separately complete email verification (Step 2.2.3).
 */
export class RegisterResponseDto {
  @ApiProperty({
    description: 'Database-generated user UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Normalized email address (lowercase)',
    example: 'alice@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'Assigned role — always AUTHOR at registration',
    enum: UserRole,
    example: UserRole.AUTHOR,
  })
  role!: UserRole;

  @ApiProperty({
    description: 'Account status — ACTIVE by default',
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @ApiProperty({
    description:
      'Email verification timestamp — always null until email is verified',
    nullable: true,
    example: null,
  })
  emailVerifiedAt!: Date | null;

  @ApiProperty({
    description: 'Account creation timestamp (UTC, millisecond precision)',
    example: '2026-10-14T07:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Account last-updated timestamp (UTC, millisecond precision)',
    example: '2026-10-14T07:00:00.000Z',
  })
  updatedAt!: Date;
}
