import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { JwtTokenService } from './jwt-token.service';
import jwtConfig from '../../../config/jwt.config';

describe('JwtTokenService', () => {
  let service: JwtTokenService;
  let jwtService: JwtService;

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const mockConfig = {
    privateKey,
    publicKey,
    issuer: 'test-issuer',
    audience: 'test-audience',
    accessTtlSeconds: 900,
    sessionDefaultTtlHours: 24,
    sessionRememberTtlDays: 30,
    cookieSecure: false,
    cookieSameSite: 'lax' as const,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        JwtTokenService,
        {
          provide: jwtConfig.KEY,
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<JwtTokenService>(JwtTokenService);
    jwtService = module.get<JwtService>(JwtService);
  });

  const VALID_USER_ID = '11111111-1111-1111-1111-111111111111';
  const VALID_SESSION_ID = '22222222-2222-2222-2222-222222222222';

  it('signs and verifies a valid RS256 token', async () => {
    const token = await service.signAccessToken({
      userId: VALID_USER_ID,
      sessionId: VALID_SESSION_ID,
    });

    expect(token).toBeDefined();

    const payload = await service.verifyAccessToken(token);
    expect(payload.sub).toBe(VALID_USER_ID);
    expect(payload.sid).toBe(VALID_SESSION_ID);
    expect(payload.iss).toBe(mockConfig.issuer);
    expect(payload.aud).toBe(mockConfig.audience);
    expect(payload.jti).toBeDefined();
  });

  it('rejects expired tokens', async () => {
    const expiredToken = await jwtService.signAsync(
      { sub: VALID_USER_ID, sid: VALID_SESSION_ID },
      {
        privateKey,
        algorithm: 'RS256',
        issuer: mockConfig.issuer,
        audience: mockConfig.audience,
        expiresIn: -10, // already expired
      },
    );

    await expect(service.verifyAccessToken(expiredToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects tokens signed with a different key', async () => {
    const anotherPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const untrustedToken = await jwtService.signAsync(
      { sub: VALID_USER_ID, sid: VALID_SESSION_ID },
      {
        privateKey: anotherPair.privateKey,
        algorithm: 'RS256',
        issuer: mockConfig.issuer,
        audience: mockConfig.audience,
        expiresIn: 900,
      },
    );

    await expect(service.verifyAccessToken(untrustedToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects tokens with non-RS256 algorithm', async () => {
    // Attempt HS256 symmetric signing
    const symmetricToken = await jwtService.signAsync(
      { sub: VALID_USER_ID, sid: VALID_SESSION_ID },
      {
        secret: 'secret-key-12345678901234567890',
        algorithm: 'HS256',
        issuer: mockConfig.issuer,
        audience: mockConfig.audience,
      },
    );

    await expect(service.verifyAccessToken(symmetricToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects tokens with mismatched issuer or audience', async () => {
    const wrongIssuerToken = await jwtService.signAsync(
      { sub: VALID_USER_ID, sid: VALID_SESSION_ID },
      {
        privateKey,
        algorithm: 'RS256',
        issuer: 'wrong-issuer',
        audience: mockConfig.audience,
      },
    );

    await expect(service.verifyAccessToken(wrongIssuerToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects tokens where sub or sid is not a valid UUID', async () => {
    const invalidSubToken = await jwtService.signAsync(
      { sub: 'not-a-uuid', sid: VALID_SESSION_ID },
      {
        privateKey,
        algorithm: 'RS256',
        issuer: mockConfig.issuer,
        audience: mockConfig.audience,
      },
    );

    await expect(service.verifyAccessToken(invalidSubToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
