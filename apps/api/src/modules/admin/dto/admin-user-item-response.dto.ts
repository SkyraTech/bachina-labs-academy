import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';

export class AdminUserItemResponseDto {
  @ApiProperty({ description: 'User unique UUID identifier', example: 'd3b07384-d113-4944-9c8e-aa672979b022' })
  id: string;

  @ApiProperty({ description: 'Authorized user account email address', example: 'author@bachinalabs.com' })
  email: string;

  @ApiProperty({ description: 'Platform access role', enum: UserRole, example: UserRole.AUTHOR })
  role: UserRole;

  @ApiProperty({ description: 'Account lifecycle status', enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({ description: 'Whether the user email verification has been completed', example: true })
  isEmailVerified: boolean;

  @ApiProperty({ description: 'Account creation ISO timestamp', example: '2026-01-15T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: 'Account last updated ISO timestamp', example: '2026-02-01T12:00:00.000Z' })
  updatedAt: string;
}

