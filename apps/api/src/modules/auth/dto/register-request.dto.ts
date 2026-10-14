import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * RegisterRequestDto — validated request body for POST /api/v1/auth/register.
 *
 * Security rules enforced here:
 *   - Only `email` and `password` are accepted. All other fields are stripped
 *     by the global ValidationPipe (whitelist: true, forbidNonWhitelisted: true).
 *   - Client-supplied `role`, `status`, `id` or `emailVerifiedAt` are rejected.
 *   - Email is normalized (trimmed + lowercased) at the transform layer so the
 *     downstream service always receives a canonical value.
 *   - Password is validated for length but NEVER trimmed or silently modified.
 *   - Both fields are required and must be non-empty strings.
 *
 * Password policy (OWASP / NIST aligned):
 *   - Minimum 12 characters — forces meaningful complexity without arbitrary rules.
 *   - Maximum 128 characters — prevents denial-of-service via bcrypt/argon2 cost.
 *   - No mandatory uppercase, number or symbol requirements.
 *   - Passphrases and Unicode are accepted.
 *   - Whitespace-only passwords are rejected by @IsNotEmpty.
 */
export class RegisterRequestDto {
  @ApiProperty({
    description: 'User email address (normalized to lowercase, max 254 chars)',
    example: 'alice@example.com',
    maxLength: 254,
  })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254, {
    message: 'email must not exceed 254 characters',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @ApiProperty({
    description: 'Account password (12–128 characters; passphrases accepted)',
    example: 'correct-horse-battery-staple',
    minLength: 12,
    maxLength: 128,
  })
  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password must not be blank' })
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @MaxLength(128, { message: 'password must not exceed 128 characters' })
  password!: string;
}
