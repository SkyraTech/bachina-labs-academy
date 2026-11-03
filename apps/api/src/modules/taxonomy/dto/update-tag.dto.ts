import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateTagDto {
  @ApiPropertyOptional({
    description: 'Updated tag name (2 to 80 characters)',
    example: 'Nest.js Framework',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'name must be a string' })
  @MinLength(2, { message: 'name must be at least 2 characters long' })
  @MaxLength(80, { message: 'name must not exceed 80 characters' })
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated unique lowercase kebab-case slug (2 to 120 characters)',
    example: 'nestjs-framework',
  })
  @IsOptional()
  @IsString({ message: 'slug must be a string' })
  @MinLength(2, { message: 'slug must be at least 2 characters long' })
  @MaxLength(120, { message: 'slug must not exceed 120 characters' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must consist of lowercase alphanumeric words separated by single hyphens',
  })
  slug?: string;
}

