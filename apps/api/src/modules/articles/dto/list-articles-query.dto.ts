import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsString,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
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
  @Type(() => Number)
  @IsInt({ message: 'pageSize must be an integer' })
  @Min(1, { message: 'pageSize must be at least 1' })
  @Max(50, { message: 'pageSize must not exceed 50' })
  pageSize?: number;

  @IsOptional()
  @IsEnum(ArticleStatus, {
    message: 'status must be DRAFT, PUBLISHED, or ARCHIVED',
  })
  status?: ArticleStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'search must be a string' })
  @MaxLength(100, { message: 'search must not exceed 100 characters' })
  search?: string;

  @IsOptional()
  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId?: string;
}
