import {
  IsInt,
  IsOptional,
  Max,
  Min,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PublicArticlesQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination (1-based)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of articles per page',
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(50, { message: 'limit must not exceed 50' })
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter articles by published category slug',
    example: 'backend-engineering',
  })
  @IsOptional()
  @IsString({ message: 'category must be a string' })
  @MinLength(2, { message: 'category must be at least 2 characters long' })
  @MaxLength(160, { message: 'category must not exceed 160 characters' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'category must consist of lowercase alphanumeric words separated by single hyphens',
  })
  category?: string;

  @ApiPropertyOptional({
    description: 'Filter articles by published tag slug',
    example: 'postgresql',
  })
  @IsOptional()
  @IsString({ message: 'tag must be a string' })
  @MinLength(2, { message: 'tag must be at least 2 characters long' })
  @MaxLength(120, { message: 'tag must not exceed 120 characters' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'tag must consist of lowercase alphanumeric words separated by single hyphens',
  })
  tag?: string;

  @ApiPropertyOptional({
    description: 'Search keyword matching published article title or summary',
    example: 'postgresql',
    maxLength: 120,
  })
  @IsOptional()
  @IsString({ message: 'q must be a string' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return value;
  })
  @MaxLength(120, { message: 'q must not exceed 120 characters' })
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\x00-\x1F\x7F]*$/, {
    message: 'q must not contain control characters',
  })
  q?: string;
}
