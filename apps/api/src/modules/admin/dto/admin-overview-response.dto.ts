import { ApiProperty } from '@nestjs/swagger';

export class AdminUserByRoleMetricsDto {
  @ApiProperty({ description: 'Number of accounts with AUTHOR role', example: 8 })
  author: number;

  @ApiProperty({ description: 'Number of accounts with ADMIN role', example: 1 })
  admin: number;
}

export class AdminUserByStatusMetricsDto {
  @ApiProperty({ description: 'Number of active accounts', example: 9 })
  active: number;

  @ApiProperty({ description: 'Number of suspended accounts', example: 0 })
  suspended: number;

  @ApiProperty({ description: 'Number of disabled accounts', example: 0 })
  disabled: number;
}

export class AdminUserMetricsDto {
  @ApiProperty({ description: 'Total registered user accounts', example: 9 })
  total: number;

  @ApiProperty({ description: 'Number of accounts with confirmed email', example: 8 })
  verified: number;

  @ApiProperty({ description: 'Number of accounts awaiting email verification', example: 1 })
  unverified: number;

  @ApiProperty({ description: 'Distribution of users by role', type: AdminUserByRoleMetricsDto })
  byRole: AdminUserByRoleMetricsDto;

  @ApiProperty({ description: 'Distribution of users by account status', type: AdminUserByStatusMetricsDto })
  byStatus: AdminUserByStatusMetricsDto;
}

export class AdminArticleMetricsDto {
  @ApiProperty({ description: 'Total articles across all statuses', example: 25 })
  total: number;

  @ApiProperty({ description: 'Number of unpublished drafts', example: 5 })
  draft: number;

  @ApiProperty({ description: 'Number of live published articles', example: 20 })
  published: number;

  @ApiProperty({ description: 'Number of archived articles', example: 0 })
  archived: number;

  @ApiProperty({ description: 'Total immutable published snapshots in provenance store', example: 28 })
  totalPublishedSnapshots: number;
}

export class AdminTaxonomyMetricsDto {
  @ApiProperty({ description: 'Total curated categories', example: 5 })
  totalCategories: number;

  @ApiProperty({ description: 'Total curated tags', example: 12 })
  totalTags: number;
}

export class AdminOverviewResponseDto {
  @ApiProperty({ description: 'User account and identity metrics', type: AdminUserMetricsDto })
  users: AdminUserMetricsDto;

  @ApiProperty({ description: 'Article and publishing lifecycle metrics', type: AdminArticleMetricsDto })
  articles: AdminArticleMetricsDto;

  @ApiProperty({ description: 'Taxonomy and classification metrics', type: AdminTaxonomyMetricsDto })
  taxonomy: AdminTaxonomyMetricsDto;
}

