import { ApiProperty } from '@nestjs/swagger';

export class ActiveSessionResponseDto {
  @ApiProperty({
    example: '11111111-1111-1111-1111-111111111111',
    description: 'Unique UUID of the session',
  })
  id!: string;

  @ApiProperty({
    example: '2026-10-14T12:00:00.000Z',
    description: 'Timestamp when the session was created',
  })
  createdAt!: Date;

  @ApiProperty({
    example: '2026-10-14T12:30:00.000Z',
    nullable: true,
    description: 'Timestamp of the most recent activity on this session',
  })
  lastSeenAt!: Date | null;

  @ApiProperty({
    example: '2026-10-15T12:00:00.000Z',
    description: 'Absolute expiration date of the session',
  })
  expiresAt!: Date;

  @ApiProperty({
    example: false,
    description: 'Whether the session was established with Remember Me',
  })
  rememberMe!: boolean;

  @ApiProperty({
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
    nullable: true,
    description: 'User-Agent header captured during session establishment',
  })
  userAgent!: string | null;

  @ApiProperty({
    example: '127.0.0.1',
    nullable: true,
    description: 'IP address captured during session establishment',
  })
  ipAddress!: string | null;

  @ApiProperty({
    example: true,
    description: 'True if this session matches the current request context',
  })
  isCurrent!: boolean;
}
