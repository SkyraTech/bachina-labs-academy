import { IsDefined, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DeleteArticleQueryDto {
  @IsDefined({ message: 'expectedRevision is required' })
  @Type(() => Number)
  @IsInt({ message: 'expectedRevision must be an integer' })
  @Min(1, { message: 'expectedRevision must be at least 1' })
  expectedRevision: number;
}

