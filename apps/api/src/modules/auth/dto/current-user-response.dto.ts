import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';

export class CurrentUserResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'author@skyra-tech.com' })
  email!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.AUTHOR })
  role!: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status!: UserStatus;

  @ApiProperty({ example: '2026-10-14T12:00:00.000Z', nullable: true })
  emailVerifiedAt!: Date | null;
}
