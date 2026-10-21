import {
  Injectable,
  Logger,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  OnModuleInit,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UsersRepository } from '../../users/users.repository';
import { SessionsRepository } from '../../sessions/sessions.repository';
import { SessionsService } from '../../sessions/sessions.service';
import { PasswordHashingService } from './password-hashing.service';
import { RefreshTokenService } from './refresh-token.service';
import { JwtTokenService } from './jwt-token.service';
import { CookieService } from './cookie.service';
import { AuthAbuseService } from './auth-abuse.service';
import { getClientIp } from '../../../common/utils/client-ip.util';
import { RequestContextService } from '../../../common/observability/request-context.service';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditActorFactory } from '../../audit/types/audit-event.types.js';
import type { LoginRequestDto } from '../dto/login-request.dto.js';
import type { LoginResponseDto } from '../dto/login-response.dto.js';
import type { RefreshResponseDto } from '../dto/refresh-response.dto.js';

@Injectable()
export class LoginService implements OnModuleInit {
  private readonly logger = new Logger(LoginService.name);
  private dummyPasswordHash: string = '';

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly sessionsRepository: SessionsRepository,
    private readonly sessionsService: SessionsService,
    private readonly passwordHashingService: PasswordHashingService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly jwtTokenService: JwtTokenService,
    private readonly cookieService: CookieService,
    private readonly authAbuseService: AuthAbuseService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Generate a valid Argon2id hash once at startup for timing-attack mitigation
    try {
      this.dummyPasswordHash = await this.passwordHashingService.hash(
        'dummy-timing-mitigation-secret',
      );
    } catch {
      // Fallback dummy hash
      this.dummyPasswordHash =
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXJhbmRvbXNhbHQ$7fN71N+9u0yJtZ7K6vM9aB4P8q3e2W1x5z7y9A';
    }
  }

  /**
   * Authenticates user credentials, establishes a PostgreSQL session,
   * generates an RS256 JWT access token and opaque refresh token,
   * and dispatches them via secure HttpOnly cookies.
   */
  async login(
    dto: LoginRequestDto,
    req: Request,
    res: Response,
  ): Promise<LoginResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const rememberMe = Boolean(dto.rememberMe);
    const ipAddress = getClientIp(req);

    // Anti-automation & brute-force abuse check (IP and privacy-preserving email digest)
    const abuseCheck = this.authAbuseService.checkLoginAllowed(ipAddress, email);
    if (abuseCheck.blocked) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many failed login attempts. Please wait before retrying.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const creds = await this.usersRepository.findPasswordCredentialsByEmail(email);

    // Mitigate user enumeration timing differences: if user not found or has no password,
    // execute dummy Argon2id verification so response time matches an incorrect password.
    if (!creds || !creds.passwordHash) {
      this.logger.warn(
        `Authentication failed: invalid credentials [action=auth.login, outcome=failure, ip=${ipAddress}]`,
      );
      this.authAbuseService.recordFailedAttempt(ipAddress, email);
      await this.passwordHashingService.verify(this.dummyPasswordHash, dto.password).catch(() => false);
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isMatch = await this.passwordHashingService.verify(creds.passwordHash, dto.password);
    if (!isMatch) {
      this.logger.warn(
        `Authentication failed: invalid credentials [action=auth.login, outcome=failure, ip=${ipAddress}]`,
      );
      this.authAbuseService.recordFailedAttempt(ipAddress, email);
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (creds.status !== 'ACTIVE') {
      this.logger.warn(
        `Authentication rejected: inactive account [action=auth.login, outcome=failure, userId=${creds.id}]`,
      );
      throw new UnauthorizedException('Your account is not active. Please contact support.');
    }

    if (!creds.emailVerifiedAt) {
      this.logger.warn(
        `Authentication rejected: unverified email [action=auth.login, outcome=failure, userId=${creds.id}]`,
      );
      throw new UnauthorizedException('Please verify your email address before logging in.');
    }

    // Reset failed authentication counter on successful verification
    this.authAbuseService.recordSuccessfulLogin(ipAddress, email);

    // Capture device metadata
    const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 1024) : null;

    // Issue opaque refresh token
    const { rawToken, tokenHash } = this.refreshTokenService.generateRefreshToken();

    // Persist session and mandatory transactional audit log in PostgreSQL
    const safeSession = await this.prisma.$transaction(async (tx) => {
      const session = await this.sessionsService.createSession(
        {
          userId: creds.id,
          refreshTokenHash: tokenHash,
          rememberMe,
          userAgent,
          ipAddress,
        },
        tx,
      );

      await this.auditService.recordTransactional(tx, {
        action: 'auth.login.succeeded',
        actor: AuditActorFactory.fromVerifiedLogin({
          id: creds.id,
          role: creds.role as 'AUTHOR' | 'ADMIN',
        }),
        resourceType: 'SESSION',
        resourceId: session.id, // Privacy Option A: actual session UUID
        outcome: 'SUCCESS',
        metadata: {
          authMethod: 'PASSWORD',
          rememberMe,
        },
      });

      return session;
    });

    // Sign RS256 JWT access token
    const accessToken = await this.jwtTokenService.signAccessToken({
      userId: creds.id,
      sessionId: safeSession.id,
    });

    // Set HttpOnly cookies
    this.cookieService.setAuthCookies(res, {
      accessToken,
      refreshToken: rawToken,
      rememberMe,
      sessionExpiresAt: safeSession.expiresAt,
    });

    // Authoritative security boundary: bind verified user identity to request context
    RequestContextService.setUserId(creds.id);

    this.logger.log(
      `Authentication successful [action=auth.login, outcome=success, userId=${creds.id}, sessionId=${safeSession.id}]`,
    );

    return {
      message: 'Login successful.',
      user: {
        id: creds.id,
        email: creds.email,
        role: creds.role,
        status: creds.status,
        emailVerifiedAt: creds.emailVerifiedAt,
      },
    };
  }

  /**
   * Refreshes an authenticated session using the opaque refresh cookie.
   * Atomically rotates the refresh token hash via compare-and-swap.
   */
  async refresh(
    rawRefreshToken: string | undefined,
    req: Request,
    res: Response,
  ): Promise<RefreshResponseDto> {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      throw new UnauthorizedException('Authentication refresh token is required.');
    }

    const tokenHash = this.refreshTokenService.hashRefreshToken(rawRefreshToken);
    const session = await this.sessionsRepository.findByRefreshTokenHash(tokenHash);

    if (!session) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const now = new Date();
    if (session.revokedAt !== null || session.expiresAt <= now) {
      throw new UnauthorizedException('Session has expired or was revoked.');
    }

    const user = await this.usersRepository.findById(session.userId);
    if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) {
      throw new UnauthorizedException('Account is not active or verified.');
    }

    // Generate next opaque refresh token
    const nextToken = this.refreshTokenService.generateRefreshToken();

    // Atomic compare-and-swap rotation
    const rotationResult = await this.sessionsRepository.rotateRefreshToken({
      sessionId: session.id,
      currentRefreshTokenHash: tokenHash,
      newRefreshTokenHash: nextToken.tokenHash,
      now,
    });

    if (!rotationResult.success) {
      // In case another concurrent request won the rotation race, safely reject the stale token
      this.logger.debug(
        `Refresh rotation rejected for session ${session.id}: ${rotationResult.reason}`,
      );
      throw new UnauthorizedException('Invalid or stale refresh token.');
    }

    // Sign fresh RS256 JWT access token
    const accessToken = await this.jwtTokenService.signAccessToken({
      userId: user.id,
      sessionId: session.id,
    });

    // Update HttpOnly cookies
    this.cookieService.setAuthCookies(res, {
      accessToken,
      refreshToken: nextToken.rawToken,
      rememberMe: session.rememberMe,
      sessionExpiresAt: session.expiresAt,
    });

    // Authoritative security boundary: bind verified user identity to request context
    RequestContextService.setUserId(user.id);

    this.logger.log(
      `Session refresh successful [action=auth.session.refresh, outcome=success, userId=${user.id}, sessionId=${session.id}]`,
    );

    return {
      message: 'Session refreshed successfully.',
    };
  }
}
