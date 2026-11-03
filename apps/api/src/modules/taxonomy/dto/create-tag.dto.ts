import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateTagDto {
  @ApiProperty({
    description: 'Tag name (2 to 80 characters)',
    example: 'NestJS',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'name is required' })
  @IsString({ message: 'name must be a string' })
  @MinLength(2, { message: 'name must be at least 2 characters long' })
  @MaxLength(80, { message: 'name must not exceed 80 characters' })
  name: string;

  @ApiProperty({
    description: 'Unique lowercase kebab-case slug (2 to 120 characters)',
    example: 'nestjs',
  })
  @IsNotEmpty({ message: 'slug is required' })
  @IsString({ message: 'slug must be a string' })
  @MinLength(2, { message: 'slug must be at least 2 characters long' })
  @MaxLength(120, { message: 'slug must not exceed 120 characters' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must consist of lowercase alphanumeric words separated by single hyphens',
  })
  slug: string;
}

