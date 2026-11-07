import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({
    description: 'Plain-text comment body (1 to 2,000 characters)',
    example: 'This article provides a very clear explanation of immutable snapshots.',
    minLength: 1,
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty({ message: 'Comment body must not be empty or whitespace only.' })
  @MaxLength(2000, { message: 'Comment body cannot exceed 2000 characters.' })
  body!: string;
}

