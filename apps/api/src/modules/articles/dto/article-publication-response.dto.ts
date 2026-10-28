import { ApiProperty } from '@nestjs/swagger';
import { ArticleStatus } from '@prisma/client';

export class ArticlePublicationResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the published article',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  articleId!: string;

  @ApiProperty({
    description: 'Publication lifecycle status',
    enum: ArticleStatus,
    example: ArticleStatus.PUBLISHED,
  })
  status!: ArticleStatus;

  @ApiProperty({
    description: 'Current draft revision of the article',
    example: 8,
  })
  draftRevision!: number;

  @ApiProperty({
    description: 'Currently published snapshot revision',
    example: 8,
  })
  publishedRevision!: number;

  @ApiProperty({
    description: 'Published URL slug of the article',
    example: 'introduction-to-postgresql',
  })
  publishedSlug!: string;

  @ApiProperty({
    description: 'UUID of the current immutable snapshot record',
    example: '222e4567-e89b-12d3-a456-426614174000',
  })
  currentSnapshotId!: string;

  @ApiProperty({
    description: 'ISO 8601 timestamp representing original publication time',
    example: '2026-10-25T15:30:00.000Z',
  })
  publishedAt!: string;
}
