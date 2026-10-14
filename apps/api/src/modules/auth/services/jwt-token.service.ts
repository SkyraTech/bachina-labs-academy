import { Injectable, Logger, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { ConfigType } from '@nestjs/config';
import jwtConfig from '../../../config/jwt.config';
import type { AccessTokenPayload } from '../types/jwt.types';

export interface SignAccessTokenParams {
  userId: string;
  sessionId: string;
  jti?: string;
  expiresInSeconds?: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtTokenService {
  private readonly logger = new Logger(JwtTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY)
    private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  /**
   * Signs a short-lived access JWT (15m) using RS256.
   */
  async signAccessToken(params: SignAccessTokenParams): Promise<string> {
    const jti = params.jti ?? randomUUID();

    return await this.jwtService.signAsync(
      {
        sub: params.userId,
        sid: params.sessionId,
      },
      {
        jwtid: jti,
        privateKey: this.config.privateKey,
        algorithm: 'RS256',
        issuer: this.config.issuer,
        audience: this.config.audience,
        expiresIn:
          params.expiresInSeconds !== undefined
            ? params.expiresInSeconds
            : this.config.accessTtlSeconds,
      },
    );
  }

  /**
   * Verifies an access JWT using the configured public key.
   * Strictly pins the algorithm to RS256 and validates issuer, audience, and UUID claims.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        publicKey: this.config.publicKey,
        algorithms: ['RS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
      });

      if (!payload.sub || !UUID_REGEX.test(payload.sub)) {
        throw new Error('JWT sub claim must be a valid UUID');
      }

      if (!payload.sid || !UUID_REGEX.test(payload.sid)) {
        throw new Error('JWT sid claim must be a valid UUID');
      }

      return payload;
    } catch (error) {
      this.logger.debug(
        `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException('Invalid or expired authentication token.');
    }
  }

  get accessTtlSeconds(): number {
    return this.config.accessTtlSeconds;
  }
}
