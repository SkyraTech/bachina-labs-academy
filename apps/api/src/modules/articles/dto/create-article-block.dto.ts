import {
  IsDefined,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleBlockType } from '@prisma/client';

export class CreateArticleBlockDto {
  @ApiProperty({
    description: 'Expected current article draft revision number. Required for optimistic concurrency.',
    example: 1,
    minimum: 1,
  })
  @IsDefined({ message: 'expectedRevision is required' })
  @Type(() => Number)
  @IsInt({ message: 'expectedRevision must be an integer number' })
  @Min(1, { message: 'expectedRevision must not be less than 1' })
  expectedRevision!: number;

  @ApiProperty({
    description: 'Type of content block to create.',
    enum: ArticleBlockType,
    example: ArticleBlockType.HEADING,
  })
  @IsDefined({ message: 'type is required' })
  @IsEnum(ArticleBlockType, { message: 'type must be a valid ArticleBlockType enum value' })
  type!: ArticleBlockType;

  @ApiProperty({
    description: 'JSON object payload conforming to the chosen block type.',
    example: { text: 'Introduction to Distributed Transactions', level: 2 },
  })
  @IsDefined({ message: 'content is required' })
  @IsObject({ message: 'content must be a non-null JSON object' })
  content!: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Referenced media asset UUID (required for IMAGE blocks, prohibited for others).',
    example: '11111111-1111-4111-8111-111111111111',
  })
  @IsOptional()
  @IsUUID('4', { message: 'mediaAssetId must be a valid UUID v4' })
  mediaAssetId?: string | null;

  @ApiPropertyOptional({
    description: 'Schema version for block content (defaults to 1).',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'schemaVersion must be an integer' })
  @Min(1, { message: 'schemaVersion must be at least 1' })
  schemaVersion?: number;
}
