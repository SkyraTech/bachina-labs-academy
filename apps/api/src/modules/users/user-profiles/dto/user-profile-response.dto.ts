import { ApiProperty } from '@nestjs/swagger';

export class UserProfileResponseDto {
  @ApiProperty({ description: 'Profile UUID', example: 'd3b07384-d113-40e1-bbd4-6e06da8d3e26', nullable: true })
  id!: string | null;

  @ApiProperty({ description: 'User UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  userId!: string;

  @ApiProperty({ description: 'Display name', example: 'Jane Doe' })
  displayName!: string;

  @ApiProperty({ description: 'Whether the profile is a fallback representation', example: false })
  isFallback!: boolean;

  @ApiProperty({ description: 'Creation timestamp', example: '2026-11-06T00:00:00.000Z', nullable: true })
  createdAt!: string | null;

  @ApiProperty({ description: 'Update timestamp', example: '2026-11-06T00:00:00.000Z', nullable: true })
  updatedAt!: string | null;
}

