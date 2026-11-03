import { ApiProperty } from '@nestjs/swagger';
import { TagResponseDto } from './tag-response.dto.js';

export class PaginatedTagsResponseDto {
  @ApiProperty({ type: [TagResponseDto], description: 'List of tags' })
  items: TagResponseDto[];

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Number of items per page', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total count of matching tags', example: 15 })
  total: number;

  @ApiProperty({ description: 'Total number of pages', example: 1 })
  totalPages: number;
}

