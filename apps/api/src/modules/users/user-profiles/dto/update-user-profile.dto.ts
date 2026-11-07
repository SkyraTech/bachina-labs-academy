import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class UpdateUserProfileDto {
  @ApiProperty({
    description: 'Display name for public attribution (2-50 characters, Unicode-safe, non-email)',
    example: 'Jane Doe',
    minLength: 2,
    maxLength: 50,
  })
  @IsString()
  @IsNotEmpty()
  @Length(2, 50, { message: 'Display name must be between 2 and 50 characters.' })
  @Matches(/^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}\s\-_'.]{0,48}[\p{L}\p{N}\p{M}.]?$/u, {
    message: 'Display name contains invalid characters or starts/ends with a separator.',
  })
  displayName!: string;
}
