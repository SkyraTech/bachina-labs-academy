import { IsOptional, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ArticleStatus } from '@prisma/client';

export class ListArticlesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(50, { message: 'limit must not exceed 50' })
  limit?: number = 20;

  @IsOptional()
  @IsEnum(ArticleStatus, {
    message: 'status must be DRAFT, PUBLISHED, or ARCHIVED',
  })
  status?: ArticleStatus;
}
