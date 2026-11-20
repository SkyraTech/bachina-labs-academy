import { ApiProperty } from '@nestjs/swagger';
import { ArticleStatus } from '@prisma/client';

export class AuthorDashboardArticleItemDto {
  @ApiProperty({ description: 'Article UUID', example: '11111111-1111-4000-8000-000000000001' })
  id!: string;

  @ApiProperty({ description: 'Article title', example: 'Understanding Reactive Signals in Angular' })
  title!: string;

  @ApiProperty({ enum: ArticleStatus, description: 'Current article status', example: ArticleStatus.PUBLISHED })
  status!: ArticleStatus;

  @ApiProperty({ description: 'ISO 8601 last update timestamp', example: '2026-11-18T10:00:00.000Z' })
  updatedAt!: string;
}

export class AuthorDashboardMetricsDto {
  @ApiProperty({ description: 'Total articles authored across all lifecycle statuses', example: 12 })
  total!: number;

  @ApiProperty({ description: 'Number of articles currently in DRAFT status', example: 4 })
  draft!: number;

  @ApiProperty({ description: 'Number of articles currently in PUBLISHED status', example: 7 })
  published!: number;

  @ApiProperty({ description: 'Number of articles currently in ARCHIVED status', example: 1 })
  archived!: number;
}

export class AuthorDashboardResponseDto {
  @ApiProperty({ type: AuthorDashboardMetricsDto, description: 'Author-scoped article metrics' })
  metrics!: AuthorDashboardMetricsDto;

  @ApiProperty({
    type: [AuthorDashboardArticleItemDto],
    description: 'Up to 5 most recently updated articles owned by this author',
  })
  recentlyUpdated!: AuthorDashboardArticleItemDto[];
}
