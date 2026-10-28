import type { ArticleStatus } from '@prisma/client';

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
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
