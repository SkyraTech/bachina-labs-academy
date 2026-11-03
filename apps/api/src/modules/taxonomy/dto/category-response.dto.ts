import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty({ description: 'Unique category identifier (UUID)', example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
  id: string;

  @ApiProperty({ description: 'Category display name', example: 'Backend Development' })
  name: string;

  @ApiProperty({ description: 'Unique normalized slug', example: 'backend-development' })
  slug: string;

  @ApiPropertyOptional({ description: 'Category description', example: 'Articles about backend engineering', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Timestamp when category was created' })
  createdAt: Date;

  @ApiProperty({ description: 'Timestamp when category was last updated' })
  updatedAt: Date;
}

