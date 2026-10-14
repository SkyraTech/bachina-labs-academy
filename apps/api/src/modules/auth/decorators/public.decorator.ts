import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator marking an endpoint or controller as publicly accessible,
 * exempting it from the global JwtAccessGuard.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
