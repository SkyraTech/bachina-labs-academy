import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from './category-response.dto.js';

export class PaginatedCategoriesResponseDto {
  @ApiProperty({ type: [CategoryResponseDto], description: 'List of categories' })
  items: CategoryResponseDto[];

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Number of items per page', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total count of matching categories', example: 42 })
  total: number;

  @ApiProperty({ description: 'Total number of pages', example: 3 })
  totalPages: number;
}

