import {
  IsArray,
  IsDefined,
  IsInt,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderArticleBlocksDto {
  @ApiProperty({
    description: 'Expected current article draft revision number. Required for optimistic concurrency.',
    example: 4,
    minimum: 1,
  })
  @IsDefined({ message: 'expectedRevision is required' })
  @Type(() => Number)
  @IsInt({ message: 'expectedRevision must be an integer number' })
  @Min(1, { message: 'expectedRevision must not be less than 1' })
  expectedRevision!: number;

  @ApiProperty({
    description: 'Complete ordered list of all block UUIDs belonging to the article.',
    example: [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ],
    type: [String],
  })
  @IsDefined({ message: 'blockIds is required' })
  @IsArray({ message: 'blockIds must be an array of UUIDs' })
  @IsUUID('4', { each: true, message: 'Each blockId must be a valid UUID v4' })
  blockIds!: string[];
}
