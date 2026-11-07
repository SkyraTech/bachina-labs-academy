import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsEnum, IsString, MaxLength, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ArticleStatus } from '@prisma/client';

export class ListAdminArticlesQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination (minimum 1)',
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page (between 1 and 100)',
    default: 20,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must not exceed 100' })
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter articles by lifecycle status',
    enum: ArticleStatus,
  })
  @IsOptional()
  @IsEnum(ArticleStatus, { message: 'status must be a valid ArticleStatus' })
  status?: ArticleStatus;

  @ApiPropertyOptional({
    description: 'Search articles across title, draftSlug, and summary',
    example: 'postgresql',
  })
  @IsOptional()
  @IsString({ message: 'q must be a string' })
  @MaxLength(120, { message: 'q must not exceed 120 characters' })
  q?: string;

  @ApiPropertyOptional({
    description: 'Filter articles by category UUID',
    example: 'c1b07384-d113-4944-9c8e-aa672979b022',
  })
  @IsOptional()
  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Filter articles by author UUID',
    example: 'u1b07384-d113-4944-9c8e-aa672979b022',
  })
  @IsOptional()
  @IsUUID('4', { message: 'authorId must be a valid UUID' })
  authorId?: string;
}

