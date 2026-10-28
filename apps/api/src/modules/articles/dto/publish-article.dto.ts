import { IsDefined, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PublishArticleDto {
  @ApiProperty({
    description: 'Expected current article draft revision number. Required for optimistic concurrency.',
    example: 8,
    minimum: 1,
  })
  @IsDefined({ message: 'expectedRevision is required' })
  @IsInt({ message: 'expectedRevision must be an integer' })
  @Min(1, { message: 'expectedRevision must be at least 1' })
  expectedRevision!: number;
}
