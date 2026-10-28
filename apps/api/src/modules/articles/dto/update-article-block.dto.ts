import {
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateArticleBlockDto {
  @ApiProperty({
    description: 'Expected current article draft revision number. Required for optimistic concurrency.',
    example: 2,
    minimum: 1,
  })
  @IsDefined({ message: 'expectedRevision is required' })
  @Type(() => Number)
  @IsInt({ message: 'expectedRevision must be an integer number' })
  @Min(1, { message: 'expectedRevision must not be less than 1' })
  expectedRevision!: number;

  @ApiPropertyOptional({
    description: 'Updated JSON object payload for the block.',
    example: { text: 'Updated Section Title', level: 2 },
  })
  @IsOptional()
  @IsObject({ message: 'content must be a non-null JSON object' })
  content?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Updated media asset UUID (allowed only for IMAGE blocks).',
    example: '22222222-2222-4222-8222-222222222222',
  })
  @IsOptional()
  @IsUUID('4', { message: 'mediaAssetId must be a valid UUID v4' })
  mediaAssetId?: string | null;
}
