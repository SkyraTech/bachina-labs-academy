import { ApiProperty } from '@nestjs/swagger';

/**
 * PublicAuthorResponseDto — Strict public allowlist representation of an author.
 *
 * Guarantees:
 * - NEVER leaks private email, password hash, verification tokens, or session IDs.
 * - NEVER leaks draft article counts, draft titles, or unpublished content.
 * - Exposes only the stable public author identifier (UUIDv4) and public attribution.
 */
export class PublicAuthorResponseDto {
  @ApiProperty({
    description: 'Unique stable author identifier (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Public author display name',
    example: 'Academy Author',
  })
  displayName!: string;

  @ApiProperty({
    description: 'Total number of active published articles by this author',
    example: 3,
  })
  publishedArticlesCount!: number;

  @ApiProperty({
    description: 'Account member since ISO timestamp',
    example: '2026-10-01T12:00:00.000Z',
  })
  joinedAt!: string;
}

