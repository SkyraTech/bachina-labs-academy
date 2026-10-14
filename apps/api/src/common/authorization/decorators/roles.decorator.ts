import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Assigns one or more required UserRole enum values to an endpoint or controller.
 *
 * Requirements:
 * - Accepts only strongly typed Prisma UserRole enum values (AUTHOR, ADMIN).
 * - Stored in NestJS route metadata under ROLES_KEY.
 * - Does not accept arbitrary client strings.
 * - Absence of metadata implies no role restriction (standard authentication still applies).
 *
 * @example
 * @Roles(UserRole.ADMIN)
 * @Get('admin-only')
 *
 * @example
 * @Roles(UserRole.AUTHOR, UserRole.ADMIN)
 * @Post('articles')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
