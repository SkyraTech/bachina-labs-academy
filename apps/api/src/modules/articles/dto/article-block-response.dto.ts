import type { ArticleBlockResponseDto } from './article-detail-response.dto.js';

export interface ArticleBlockWithRevisionDto extends ArticleBlockResponseDto {
  draftRevision: number;
}

export interface ReorderBlocksResponseDto {
  blocks: ArticleBlockResponseDto[];
  draftRevision: number;
}
