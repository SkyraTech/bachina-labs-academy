import { ApiProperty } from '@nestjs/swagger';
import { AdminArticleItemResponseDto } from './admin-article-item-response.dto.js';

export class PaginatedAdminArticlesResponseDto {
  @ApiProperty({ description: 'Paginated article items', type: [AdminArticleItemResponseDto] })
  items: AdminArticleItemResponseDto[];

  @ApiProperty({ description: 'Total number of articles matching query filters', example: 78 })
  total: number;

  @ApiProperty({ description: 'Current page number (1-based)', example: 1 })
  page: number;

  @ApiProperty({ description: 'Page size limit applied', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total calculated pages', example: 4 })
  totalPages: number;
}

