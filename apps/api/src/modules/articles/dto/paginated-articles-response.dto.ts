import type { ArticleResponseDto } from './article-response.dto.js';

export interface PaginatedArticlesResponseDto {
  items: ArticleResponseDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
