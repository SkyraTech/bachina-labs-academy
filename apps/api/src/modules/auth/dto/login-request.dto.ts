import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginRequestDto {
  @ApiProperty({
    description: 'Registered account email address (case-insensitive, max 254 chars).',
    example: 'author@skyra-tech.com',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Must be a valid email address.' })
  @MaxLength(254, { message: 'Email address cannot exceed 254 characters.' })
  email!: string;

  @ApiProperty({
    description: 'Account password in plaintext.',
    example: 'correct-horse-battery-staple',
  })
  @IsString({ message: 'Password must be a string.' })
  @IsNotEmpty({ message: 'Password cannot be empty.' })
  password!: string;

  @ApiPropertyOptional({
    description: 'When true, issues a 30-day persistent session. Default is false (24-hour session).',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'rememberMe must be a boolean.' })
  rememberMe: boolean = false;
}
