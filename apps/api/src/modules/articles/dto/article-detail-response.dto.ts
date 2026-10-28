import type { ArticleBlockType } from '@prisma/client';
import type { ArticleResponseDto } from './article-response.dto.js';

export interface ArticleBlockResponseDto {
  id: string;
  articleId: string;
  type: ArticleBlockType;
  position: number;
  content: Record<string, unknown>;
  mediaAssetId: string | null;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleDetailResponseDto extends ArticleResponseDto {
  blocks: ArticleBlockResponseDto[];
}
