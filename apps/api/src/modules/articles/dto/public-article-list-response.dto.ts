import { ApiProperty } from '@nestjs/swagger';
import { PublicMediaResponseDto } from './public-media-response.dto.js';

export class PublicArticleItemDto {
  @ApiProperty({
    description: 'Unique identifier of the article',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Published URL slug from immutable snapshot',
    example: 'introduction-to-postgresql',
  })
  slug!: string;

  @ApiProperty({
    description: 'Article title from immutable snapshot',
    example: 'Introduction to PostgreSQL',
  })
  title!: string;

  @ApiProperty({
    description: 'Article summary from immutable snapshot',
    example: 'Learn the fundamentals of relational databases.',
    nullable: true,
  })
  summary!: string | null;

  @ApiProperty({
    description: 'Typography preset from immutable snapshot',
    example: 'MODERN_SANS',
  })
  typographyPreset!: string;

  @ApiProperty({
    description: 'Cover media projection from immutable snapshot',
    type: PublicMediaResponseDto,
    nullable: true,
  })
  cover!: PublicMediaResponseDto | null;

  @ApiProperty({
    description: 'Published snapshot revision number',
    example: 8,
  })
  revision!: number;

  @ApiProperty({
    description: 'Publication ISO timestamp from immutable snapshot',
    example: '2026-10-25T12:00:00.000Z',
  })
  publishedAt!: string;
}

export class PublicArticleListResponseDto {
  @ApiProperty({
    description: 'Array of published article summary items',
    type: [PublicArticleItemDto],
  })
  items!: PublicArticleItemDto[];

  @ApiProperty({
    description: 'Current page number (1-based)',
    example: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Number of articles requested per page',
    example: 20,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total count of published articles matching eligibility criteria',
    example: 42,
  })
  total!: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 3,
  })
  totalPages!: number;
}
