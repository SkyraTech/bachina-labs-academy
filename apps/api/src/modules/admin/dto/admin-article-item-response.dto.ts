import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus } from '@prisma/client';

export class AdminArticleAuthorSummaryDto {
  @ApiProperty({ description: 'Author unique identifier', example: 'd3b07384-d113-4944-9c8e-aa672979b022' })
  id: string;

  @ApiProperty({ description: 'Author account email', example: 'alex@example.com' })
  email: string;
}

export class AdminArticleCategorySummaryDto {
  @ApiProperty({ description: 'Category unique identifier', example: 'c1b07384-d113-4944-9c8e-aa672979b022' })
  id: string;

  @ApiProperty({ description: 'Category name', example: 'Backend Engineering' })
  name: string;

  @ApiProperty({ description: 'Category canonical URL slug', example: 'backend-engineering' })
  slug: string;
}

export class AdminArticleItemResponseDto {
  @ApiProperty({ description: 'Article unique UUID identifier', example: 'a1b07384-d113-4944-9c8e-aa672979b022' })
  id: string;

  @ApiProperty({ description: 'Current draft title', example: 'PostgreSQL 17 Performance Tuning' })
  title: string;

  @ApiProperty({ description: 'Draft URL slug', example: 'postgresql-17-performance-tuning' })
  draftSlug: string;

  @ApiPropertyOptional({ description: 'Frozen public URL slug if article has been published', example: 'postgresql-production-tuning', nullable: true })
  publishedSlug: string | null;

  @ApiPropertyOptional({ description: 'Article summary text', example: 'Comprehensive guide to PostgreSQL buffer pools.', nullable: true })
  summary: string | null;

  @ApiProperty({ description: 'Lifecycle status', enum: ArticleStatus, example: ArticleStatus.PUBLISHED })
  status: ArticleStatus;

  @ApiProperty({ description: 'Current working draft revision number', example: 3 })
  draftRevision: number;

  @ApiProperty({ description: 'Active published snapshot revision number (0 if never published)', example: 1 })
  publishedRevision: number;

  @ApiProperty({ description: 'Article author attribution', type: AdminArticleAuthorSummaryDto })
  author: AdminArticleAuthorSummaryDto;

  @ApiPropertyOptional({ description: 'Assigned category', type: AdminArticleCategorySummaryDto, nullable: true })
  category: AdminArticleCategorySummaryDto | null;

  @ApiProperty({ description: 'Article draft created ISO timestamp', example: '2026-01-20T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: 'Article last modified ISO timestamp', example: '2026-02-10T14:30:00.000Z' })
  updatedAt: string;

  @ApiPropertyOptional({ description: 'Article publication ISO timestamp (null if draft)', example: '2026-02-10T14:30:00.000Z', nullable: true })
  publishedAt: string | null;
}

