import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';
import { getClientIp } from '../utils/client-ip.util';

/**
 * AppThrottlerGuard — Production-grade identity-aware and proxy-aware rate limit guard.
 *
 * Tracking Strategy:
 * 1. For authenticated requests (where `req.user?.id` exists), keys by `user_${req.user.id}`.
 *    This isolates authenticated user quotas so users sharing a corporate NAT/proxy IP
 *    do not starve each other during normal application usage.
 * 2. For unauthenticated requests, keys by `ip_${getClientIp(req)}` using validated,
 *    proxy-trust-aware client IP resolution.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override readonly logger = new Logger(AppThrottlerGuard.name);

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const user = req['user'] as { id?: string } | undefined;
    if (user && user.id) {
      return `user_${user.id}`;
    }
    return `ip_${getClientIp(req as unknown as Request)}`;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<Request>();
    const clientIp = getClientIp(req);
    this.logger.warn(
      `Rate limit exceeded for client [action=security.rate_limit, outcome=failure, ip=${clientIp}, limit=${throttlerLimitDetail.limit}, ttl=${throttlerLimitDetail.ttl}]`,
    );
    await super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
