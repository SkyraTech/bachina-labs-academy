import { IsDefined, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteArticleBlockQueryDto {
  @ApiProperty({
    description: 'Expected current article draft revision number. Required for optimistic concurrency.',
    example: 3,
    minimum: 1,
  })
  @IsDefined({ message: 'expectedRevision is required' })
  @Type(() => Number)
  @IsInt({ message: 'expectedRevision must be an integer number' })
  @Min(1, { message: 'expectedRevision must not be less than 1' })
  expectedRevision!: number;
}
