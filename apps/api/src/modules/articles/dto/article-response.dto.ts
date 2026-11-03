import type { ArticleStatus } from '@prisma/client';

export interface TaxonomyCategorySummaryDto {
  id: string;
  name: string;
  slug: string;
}

export interface TaxonomyTagSummaryDto {
  id: string;
  name: string;
  slug: string;
}

export interface ArticleResponseDto {
  id: string;
  authorId: string;
  title: string;
  draftSlug: string;
  publishedSlug: string | null;
  summary: string | null;
  status: ArticleStatus;
  typographyPreset: string;
  coverMediaId: string | null;
  draftRevision: number;
  publishedRevision: number;
  currentSnapshotId: string | null;
  categoryId: string | null;
  tagIds: string[];
  category: TaxonomyCategorySummaryDto | null;
  tags: TaxonomyTagSummaryDto[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
