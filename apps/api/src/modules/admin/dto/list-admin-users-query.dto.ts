import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsEnum, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole, UserStatus } from '@prisma/client';

export class ListAdminUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination (minimum 1)',
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page (between 1 and 100)',
    default: 20,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must not exceed 100' })
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter users by role',
    enum: UserRole,
  })
  @IsOptional()
  @IsEnum(UserRole, { message: 'role must be a valid UserRole' })
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Filter users by account status',
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus, { message: 'status must be a valid UserStatus' })
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Search users by email',
    example: 'alex@example.com',
  })
  @IsOptional()
  @IsString({ message: 'q must be a string' })
  @MaxLength(100, { message: 'q must not exceed 100 characters' })
  q?: string;
}

