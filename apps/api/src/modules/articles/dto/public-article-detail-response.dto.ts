import { ApiProperty } from '@nestjs/swagger';
import { ArticleBlockType } from '@prisma/client';
import { PublicMediaResponseDto } from './public-media-response.dto.js';
import {
  PublicTaxonomyCategoryDto,
  PublicTaxonomyTagDto,
} from './public-article-list-response.dto.js';

export class PublicArticleBlockDto {
  @ApiProperty({
    description: 'Unique identifier of the content block',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Block type',
    enum: ArticleBlockType,
    example: ArticleBlockType.HEADING,
  })
  type!: ArticleBlockType;

  @ApiProperty({
    description: 'Zero-based sequential ordering index within the article',
    example: 0,
  })
  position!: number;

  @ApiProperty({
    description: 'Schema version of the block payload',
    example: 1,
  })
  schemaVersion!: number;

  @ApiProperty({
    description: 'Structured content payload conforming to the block type',
    example: { text: 'Getting Started', level: 2 },
  })
  content!: Record<string, any>;

  @ApiProperty({
    description: 'Safe media metadata projection for IMAGE blocks',
    type: PublicMediaResponseDto,
    nullable: true,
  })
  media!: PublicMediaResponseDto | null;
}

export class PublicArticleDetailResponseDto {
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

  @ApiProperty({
    description: 'Indicates whether immutable taxonomy was captured at publication',
    example: true,
  })
  taxonomyCaptured!: boolean;

  @ApiProperty({
    description: 'Frozen category from immutable snapshot, or null if uncategorized or legacy',
    type: PublicTaxonomyCategoryDto,
    nullable: true,
  })
  category!: PublicTaxonomyCategoryDto | null;

  @ApiProperty({
    description: 'Frozen tags array from immutable snapshot in deterministic order',
    type: [PublicTaxonomyTagDto],
  })
  tags!: PublicTaxonomyTagDto[];

  @ApiProperty({
    description: 'Ordered array of immutable content blocks',
    type: [PublicArticleBlockDto],
  })
  blocks!: PublicArticleBlockDto[];
}
