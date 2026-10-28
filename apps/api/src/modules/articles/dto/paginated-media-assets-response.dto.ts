import { ApiProperty } from '@nestjs/swagger';
import { MediaAssetResponseDto } from './media-asset-response.dto.js';

export class PaginatedMediaAssetsResponseDto {
  @ApiProperty({
    description: 'Array of owned media assets for the current page',
    type: [MediaAssetResponseDto],
  })
  items!: MediaAssetResponseDto[];

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 20,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total number of media assets owned by author',
    example: 42,
  })
  total!: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 3,
  })
  totalPages!: number;
}
