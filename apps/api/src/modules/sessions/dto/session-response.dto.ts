import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SafeSession } from '../types/session.types';

/**
 * SessionResponseDto — safe public view of an active or recent user session.
 * Excludes internal security secrets like refresh_token_hash.
 */
export class SessionResponseDto implements SafeSession {
  @ApiProperty({
    description: 'Unique session identifier (UUID). Matches the sid claim in JWT access tokens.',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Unique user identifier (UUID) owning this session.',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  userId!: string;

  @ApiProperty({
    description: 'Indicates whether Remember Me was chosen at login (30-day vs 24-hour lifetime).',
    example: false,
  })
  rememberMe!: boolean;

  @ApiProperty({
    description: 'Timestamp when this session was initially created.',
    example: '2026-10-14T12:00:00.000Z',
  })
  createdAt!: Date;

  @ApiPropertyOptional({
    description: 'Timestamp of the most recent authenticated activity from this session.',
    example: '2026-10-14T12:30:00.000Z',
    nullable: true,
  })
  lastSeenAt!: Date | null;

  @ApiProperty({
    description: 'Absolute expiration timestamp after which this session cannot be refreshed or used.',
    example: '2026-10-15T12:00:00.000Z',
  })
  expiresAt!: Date;

  @ApiPropertyOptional({
    description: 'Revocation timestamp if this session was terminated before expiration.',
    example: null,
    nullable: true,
  })
  revokedAt!: Date | null;

  @ApiPropertyOptional({
    description: 'Truncated user agent header captured when the session was created or last active.',
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    nullable: true,
  })
  userAgent!: string | null;

  @ApiPropertyOptional({
    description: 'Client IP address recorded for security audit purposes.',
    example: '127.0.0.1',
    nullable: true,
  })
  ipAddress!: string | null;

  @ApiPropertyOptional({
    description: 'True if this session corresponds to the caller making the request.',
    example: true,
  })
  isCurrent?: boolean;
}
