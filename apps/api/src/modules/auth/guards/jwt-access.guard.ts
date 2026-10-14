import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtTokenService } from '../services/jwt-token.service';
import { SessionsService } from '../../sessions/sessions.service';
import { UsersRepository } from '../../users/users.repository';
import { ACCESS_COOKIE_NAME } from '../services/cookie.service';
import type { AuthenticatedUser } from '../types/jwt.types';

@Injectable()
export class JwtAccessGuard implements CanActivate {
  private readonly logger = new Logger(JwtAccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtTokenService: JwtTokenService,
    private readonly sessionsService: SessionsService,
    private readonly usersRepository: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Check if the endpoint or controller is marked @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    // 2. Allow OPTIONS preflight requests
    if (request.method === 'OPTIONS') {
      return true;
    }

    // 3. Extract access token strictly from HttpOnly cookie (cookie-only architecture)
    const token = request.cookies?.[ACCESS_COOKIE_NAME];

    if (!token) {
      if (request.headers.authorization) {
        this.logger.warn(
          'Authorization Bearer header rejected: website authentication is strictly cookie-only',
        );
      }
      throw new UnauthorizedException('Authentication required.');
    }

    // 4. Verify RS256 signature, algorithm pinning, issuer, audience, and UUID claims
    const payload = await this.jwtTokenService.verifyAccessToken(token);

    // 5. Verify database session validity (unrevoked, unexpired, touches lastSeenAt)
    const session = await this.sessionsService.validateSession(payload.sid);
    if (!session) {
      this.logger.debug(`Session ${payload.sid} is invalid, expired, or revoked`);
      throw new UnauthorizedException('Session has expired or was revoked.');
    }

    // 6. Verify session ownership
    if (session.userId !== payload.sub) {
      this.logger.warn(
        `Session owner mismatch: token sub=${payload.sub}, session userId=${session.userId}`,
      );
      throw new UnauthorizedException('Invalid session context.');
    }

    // 7. Verify account status and email verification in PostgreSQL
    const user = await this.usersRepository.findById(payload.sub);
    if (!user || user.status !== 'ACTIVE') {
      this.logger.debug(`User ${payload.sub} not found or not active`);
      throw new UnauthorizedException('Account is not active.');
    }

    if (!user.emailVerifiedAt) {
      this.logger.debug(`User ${payload.sub} email not verified`);
      throw new UnauthorizedException('Email verification required.');
    }

    // 8. Attach typed AuthenticatedUser context (never includes hashes or secrets)
    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      sessionId: payload.sid,
    };

    return true;
  }
}
