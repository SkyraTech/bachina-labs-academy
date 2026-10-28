import {
  IsString,
  IsOptional,
  Length,
  Matches,
  MaxLength,
  IsIn,
  IsUUID,
  ValidateIf,
  IsInt,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateArticleDto {
  @IsInt({ message: 'expectedRevision must be an integer' })
  @Min(1, { message: 'expectedRevision must be at least 1' })
  expectedRevision: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(3, 255, {
    message: 'title must be between 3 and 255 characters after trimming',
  })
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'draftSlug must be lowercase alphanumeric with hyphens (e.g. intro-to-postgresql)',
  })
  @Length(3, 280, {
    message: 'draftSlug must be between 3 and 280 characters',
  })
  draftSlug?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500, {
    message: 'summary must not exceed 500 characters',
  })
  summary?: string | null;

  @IsOptional()
  @IsIn(['MODERN_SANS', 'EDITORIAL_SERIF', 'TECHNICAL_MINIMAL'], {
    message:
      'typographyPreset must be MODERN_SANS, EDITORIAL_SERIF, or TECHNICAL_MINIMAL',
  })
  typographyPreset?: 'MODERN_SANS' | 'EDITORIAL_SERIF' | 'TECHNICAL_MINIMAL';

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4', {
    message: 'coverMediaId must be a valid UUIDv4 or null',
  })
  coverMediaId?: string | null;
}
