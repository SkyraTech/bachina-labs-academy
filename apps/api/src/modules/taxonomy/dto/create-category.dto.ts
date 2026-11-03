import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Category name (2 to 120 characters)',
    example: 'Backend Development',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'name is required' })
  @IsString({ message: 'name must be a string' })
  @MinLength(2, { message: 'name must be at least 2 characters long' })
  @MaxLength(120, { message: 'name must not exceed 120 characters' })
  name: string;

  @ApiProperty({
    description: 'Unique lowercase kebab-case slug (2 to 160 characters)',
    example: 'backend-development',
  })
  @IsNotEmpty({ message: 'slug is required' })
  @IsString({ message: 'slug must be a string' })
  @MinLength(2, { message: 'slug must be at least 2 characters long' })
  @MaxLength(160, { message: 'slug must not exceed 160 characters' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must consist of lowercase alphanumeric words separated by single hyphens',
  })
  slug: string;

  @ApiPropertyOptional({
    description: 'Category description (optional, up to 500 characters)',
    example: 'Articles about backend engineering, APIs, and systems design',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'description must be a string' })
  @MaxLength(500, { message: 'description must not exceed 500 characters' })
  description?: string;
}

