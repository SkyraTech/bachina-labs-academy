import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum AdminCommentStatusFilter {
  ALL = 'ALL',
  VISIBLE = 'VISIBLE',
  REMOVED = 'REMOVED',
}

export class AdminCommentsQueryDto {
  @ApiPropertyOptional({ description: 'Page number (default: 1)', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page limit (default: 20, max: 100)', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by comment status',
    enum: AdminCommentStatusFilter,
    default: AdminCommentStatusFilter.ALL,
  })
  @IsOptional()
  @IsEnum(AdminCommentStatusFilter)
  status?: AdminCommentStatusFilter = AdminCommentStatusFilter.ALL;

  @ApiPropertyOptional({ description: 'Search term for comment body or author name' })
  @IsOptional()
  @IsString()
  search?: string;
}

