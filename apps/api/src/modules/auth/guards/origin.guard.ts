import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../services/cookie.service.js';
import { LogSanitizer } from '../../../common/observability/log-sanitizer.js';

@Injectable()
export class OriginGuard implements CanActivate {
  private readonly logger = new Logger(OriginGuard.name);
  private readonly allowedOrigins: string[];

  constructor(private readonly configService: ConfigService) {
    const origins = this.configService.get<string[]>(
      'app.corsAllowedOrigins',
      ['http://localhost:4200'],
    );
    this.allowedOrigins = Array.isArray(origins) ? origins : ['http://localhost:4200'];
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method?.toUpperCase();

    // 1. Safe / idempotent HTTP methods do not mutate server state
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    const origin = request.headers['origin'];
    const secFetchSite = request.headers['sec-fetch-site'];
    const referer = request.headers['referer'];
    const host = request.headers['host'];

    // Check whether the request targets a sensitive auth route or carries auth cookies
    const hasAuthCookies = Boolean(
      request.cookies?.[ACCESS_COOKIE_NAME] || request.cookies?.[REFRESH_COOKIE_NAME],
    );
    const url = request.url || '';
    const isSensitiveAuthRoute =
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      hasAuthCookies;

    // Helper: test if an origin URL is allowed (configured frontend origin or server's own host)
    const isAllowed = (originUrl: string): boolean => {
      if (this.allowedOrigins.includes(originUrl)) {
        return true;
      }
      if (host) {
        if (originUrl === `http://${host}` || originUrl === `https://${host}`) {
          return true;
        }
      }
      return false;
    };

    // Helper: test if origin strictly matches server's own host
    const isSameHost = (originUrl: string): boolean => {
      if (!host) return false;
      return originUrl === `http://${host}` || originUrl === `https://${host}`;
    };

    // 2. Validate Origin header if present
    if (origin !== undefined) {
      if (typeof origin !== 'string' || origin === 'null' || origin.trim() === '') {
        this.logger.warn(
          `Blocked state-changing request with invalid/null Origin: ${origin} [action=security.origin_rejected, outcome=failure]`,
        );
        throw new ForbiddenException('Invalid or untrusted origin.');
      }

      let parsedOrigin: URL;
      try {
        parsedOrigin = new URL(origin);
      } catch {
        this.logger.warn(
          `Blocked state-changing request with malformed Origin: ${origin} [action=security.origin_rejected, outcome=failure]`,
        );
        throw new ForbiddenException('Malformed Origin header.');
      }

      if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
        this.logger.warn(
          `Blocked state-changing request with unsupported protocol: ${parsedOrigin.protocol} [action=security.origin_rejected, outcome=failure]`,
        );
        throw new ForbiddenException('Origin protocol not allowed.');
      }

      const normalizedOrigin = parsedOrigin.origin;

      // Check contradictory Origin vs Sec-Fetch-Site combinations
      if (secFetchSite === 'same-origin' && !isSameHost(normalizedOrigin)) {
        this.logger.warn(
          `Contradictory headers: Sec-Fetch-Site=same-origin but Origin=${normalizedOrigin} host=${host} [action=security.origin_rejected, outcome=failure]`,
        );
        throw new ForbiddenException('Contradictory Origin and Fetch Metadata headers.');
      }

      if (secFetchSite === 'cross-site' && isSameHost(normalizedOrigin)) {
        this.logger.warn(
          `Contradictory headers: Sec-Fetch-Site=cross-site but Origin matches host=${host} [action=security.origin_rejected, outcome=failure]`,
        );
        throw new ForbiddenException('Contradictory Origin and Fetch Metadata headers.');
      }

      // Check against allowlist
      if (!isAllowed(normalizedOrigin)) {
        this.logger.warn(
          `Rejected state-changing request from untrusted origin: ${normalizedOrigin} [action=security.origin_rejected, outcome=failure]`,
        );
        throw new ForbiddenException('Origin not allowed.');
      }

      return true;
    }

    // 3. Explicit Missing-Origin Policy
    // When Origin header is missing:

    // 3a. Browser Fetch Metadata evaluation
    if (secFetchSite !== undefined) {
      if (secFetchSite === 'cross-site') {
        this.logger.warn(
          'Rejected cross-site state-changing request without allowed Origin [action=security.origin_rejected, outcome=failure]',
        );
        throw new ForbiddenException('Cross-site request blocked.');
      }

      if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') {
        // If referer is present, verify its origin
        if (referer && typeof referer === 'string') {
          let refererOrigin: string;
          try {
            refererOrigin = new URL(referer).origin;
          } catch {
            throw new ForbiddenException('Malformed Referer header.');
          }
          if (!isAllowed(refererOrigin)) {
            this.logger.warn(
              `Rejected state-changing request with untrusted Referer origin: ${refererOrigin} [action=security.origin_rejected, outcome=failure]`,
            );
            throw new ForbiddenException('Untrusted referer header.');
          }
        }
        return true;
      }

      if (secFetchSite === 'none') {
        const secFetchMode = request.headers['sec-fetch-mode'];
        if (secFetchMode === 'navigate') {
          this.logger.warn(
            'Blocked navigational state-changing request [action=security.origin_rejected, outcome=failure]',
          );
          throw new ForbiddenException('Navigational state-changing request blocked.');
        }
        return true;
      }

      throw new ForbiddenException('Invalid Sec-Fetch-Site header.');
    }

    // 3b. When both Origin and Sec-Fetch-Site are missing, verify Referer if present
    if (referer && typeof referer === 'string') {
      let refererOrigin: string;
      try {
        refererOrigin = new URL(referer).origin;
      } catch {
        throw new ForbiddenException('Malformed Referer header.');
      }
      if (!isAllowed(refererOrigin)) {
        this.logger.warn(
          `Rejected state-changing request with untrusted Referer origin: ${refererOrigin} [action=security.origin_rejected, outcome=failure]`,
        );
        throw new ForbiddenException('Untrusted referer header.');
      }
      return true;
    }

    // 3c. Origin, Sec-Fetch-Site, AND Referer are all missing
    // Do NOT permit cookie-authenticated or sensitive auth mutations without a trustworthy origin.
    // Arbitrary client-identification headers (X-Requested-With, X-Client-Platform, etc.)
    // are client-controlled and do NOT qualify as proof of caller identity.
    if (isSensitiveAuthRoute) {
      const sanitizedUrl = LogSanitizer.sanitizeUrl(url);
      this.logger.warn(
        `Blocked sensitive state-changing request (${sanitizedUrl}) missing Origin or trustworthy Fetch Metadata context [action=security.origin_rejected, outcome=failure]`,
      );
      throw new ForbiddenException('Missing Origin or client identity for state-changing request.');
    }

    // For non-cookie, non-sensitive public state-changing routes (e.g. initial registration):
    // Uncredentialed non-browser clients are permitted.
    return true;
  }
}
