import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserRole, UserStatus } from '@prisma/client';
import { LoginService } from './login.service';
import { UsersRepository } from '../../users/users.repository';
import { SessionsRepository } from '../../sessions/sessions.repository';
import { SessionsService } from '../../sessions/sessions.service';
import { PasswordHashingService } from './password-hashing.service';
import { RefreshTokenService } from './refresh-token.service';
import { JwtTokenService } from './jwt-token.service';
import { CookieService } from './cookie.service';
import type { UserPasswordCredentials } from '../../users/types';

const MOCK_DATE = new Date('2026-10-14T12:00:00.000Z');

const MOCK_CREDENTIALS: UserPasswordCredentials = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'author@skyra-tech.com',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$WJt...',
  role: UserRole.AUTHOR,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: MOCK_DATE,
  createdAt: MOCK_DATE,
  updatedAt: MOCK_DATE,
};

describe('LoginService', () => {
  let service: LoginService;
  let usersRepositoryMock: {
    findPasswordCredentialsByEmail: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let sessionsRepositoryMock: {
    findByRefreshTokenHash: ReturnType<typeof vi.fn>;
    rotateRefreshToken: ReturnType<typeof vi.fn>;
  };
  let sessionsServiceMock: {
    createSession: ReturnType<typeof vi.fn>;
  };
  let passwordHashingMock: {
    hash: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };
  let refreshTokenMock: {
    generateRefreshToken: ReturnType<typeof vi.fn>;
    hashRefreshToken: ReturnType<typeof vi.fn>;
  };
  let jwtTokenMock: {
    signAccessToken: ReturnType<typeof vi.fn>;
  };
  let cookieServiceMock: {
    setAuthCookies: ReturnType<typeof vi.fn>;
    clearAuthCookies: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    usersRepositoryMock = {
      findPasswordCredentialsByEmail: vi.fn(),
      findById: vi.fn(),
    };
    sessionsRepositoryMock = {
      findByRefreshTokenHash: vi.fn(),
      rotateRefreshToken: vi.fn(),
    };
    sessionsServiceMock = {
      createSession: vi.fn(),
    };
    passwordHashingMock = {
      hash: vi.fn().mockResolvedValue('dummy-argon2-hash'),
      verify: vi.fn(),
    };
    refreshTokenMock = {
      generateRefreshToken: vi.fn().mockReturnValue({
        rawToken: 'mock-raw-refresh-token',
        tokenHash: 'a'.repeat(64),
      }),
      hashRefreshToken: vi.fn().mockReturnValue('a'.repeat(64)),
    };
    jwtTokenMock = {
      signAccessToken: vi.fn().mockResolvedValue('mock-access-jwt'),
    };
    cookieServiceMock = {
      setAuthCookies: vi.fn(),
      clearAuthCookies: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: UsersRepository, useValue: usersRepositoryMock },
        { provide: SessionsRepository, useValue: sessionsRepositoryMock },
        { provide: SessionsService, useValue: sessionsServiceMock },
        { provide: PasswordHashingService, useValue: passwordHashingMock },
        { provide: RefreshTokenService, useValue: refreshTokenMock },
        { provide: JwtTokenService, useValue: jwtTokenMock },
        { provide: CookieService, useValue: cookieServiceMock },
      ],
    }).compile();

    service = module.get<LoginService>(LoginService);
    await service.onModuleInit();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockReq = {
    headers: { 'user-agent': 'TestAgent' },
    ip: '127.0.0.1',
  } as unknown as Request;

  const mockRes = {} as unknown as Response;

  // ── login() ────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('authenticates verified ACTIVE user and sets cookies', async () => {
      usersRepositoryMock.findPasswordCredentialsByEmail.mockResolvedValue(MOCK_CREDENTIALS);
      passwordHashingMock.verify.mockResolvedValue(true);
      sessionsServiceMock.createSession.mockResolvedValue({
        id: 'session-uuid',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const res = await service.login(
        { email: 'author@skyra-tech.com', password: 'password123', rememberMe: false },
        mockReq,
        mockRes,
      );

      expect(res.message).toBe('Login successful.');
      expect(res.user.id).toBe(MOCK_CREDENTIALS.id);
      expect(res.user.email).toBe(MOCK_CREDENTIALS.email);
      expect(cookieServiceMock.setAuthCookies).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({
          accessToken: 'mock-access-jwt',
          refreshToken: 'mock-raw-refresh-token',
          rememberMe: false,
        }),
      );
    });

    it('rejects incorrect password with generic error', async () => {
      usersRepositoryMock.findPasswordCredentialsByEmail.mockResolvedValue(MOCK_CREDENTIALS);
      passwordHashingMock.verify.mockResolvedValue(false);

      await expect(
        service.login(
          { email: 'author@skyra-tech.com', password: 'wrong-password', rememberMe: false },
          mockReq,
          mockRes,
        ),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password.'));

      expect(cookieServiceMock.setAuthCookies).not.toHaveBeenCalled();
    });

    it('performs timing-mitigation verification on unknown email', async () => {
      usersRepositoryMock.findPasswordCredentialsByEmail.mockResolvedValue(null);
      passwordHashingMock.verify.mockResolvedValue(false);

      await expect(
        service.login(
          { email: 'unknown@skyra-tech.com', password: 'password123', rememberMe: false },
          mockReq,
          mockRes,
        ),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password.'));

      // Verified that dummy hash was checked to normalize CPU time
      expect(passwordHashingMock.verify).toHaveBeenCalledTimes(1);
    });

    it('rejects unverified user', async () => {
      usersRepositoryMock.findPasswordCredentialsByEmail.mockResolvedValue({
        ...MOCK_CREDENTIALS,
        emailVerifiedAt: null,
      });
      passwordHashingMock.verify.mockResolvedValue(true);

      await expect(
        service.login(
          { email: 'author@skyra-tech.com', password: 'password123', rememberMe: false },
          mockReq,
          mockRes,
        ),
      ).rejects.toThrow(/verify your email/i);
    });

    it('rejects suspended user', async () => {
      usersRepositoryMock.findPasswordCredentialsByEmail.mockResolvedValue({
        ...MOCK_CREDENTIALS,
        status: UserStatus.SUSPENDED,
      });
      passwordHashingMock.verify.mockResolvedValue(true);

      await expect(
        service.login(
          { email: 'author@skyra-tech.com', password: 'password123', rememberMe: false },
          mockReq,
          mockRes,
        ),
      ).rejects.toThrow(/not active/i);
    });
  });

  // ── refresh() ──────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('rotates refresh token and issues fresh access token', async () => {
      const activeSession = {
        id: 'session-uuid',
        userId: MOCK_CREDENTIALS.id,
        refreshTokenHash: 'a'.repeat(64),
        rememberMe: true,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
      };

      sessionsRepositoryMock.findByRefreshTokenHash.mockResolvedValue(activeSession);
      usersRepositoryMock.findById.mockResolvedValue({
        id: MOCK_CREDENTIALS.id,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      });
      sessionsRepositoryMock.rotateRefreshToken.mockResolvedValue({
        success: true,
        session: activeSession,
      });

      const res = await service.refresh('mock-raw-refresh-token', mockReq, mockRes);

      expect(res.message).toBe('Session refreshed successfully.');
      expect(cookieServiceMock.setAuthCookies).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({
          accessToken: 'mock-access-jwt',
          rememberMe: true,
        }),
      );
    });

    it('rejects refresh when token is missing', async () => {
      await expect(service.refresh(undefined, mockReq, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects refresh when session is revoked', async () => {
      sessionsRepositoryMock.findByRefreshTokenHash.mockResolvedValue({
        id: 'session-uuid',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      });

      await expect(service.refresh('token', mockReq, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects refresh when rotation CAS fails (stale token)', async () => {
      sessionsRepositoryMock.findByRefreshTokenHash.mockResolvedValue({
        id: 'session-uuid',
        userId: MOCK_CREDENTIALS.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      usersRepositoryMock.findById.mockResolvedValue({
        id: MOCK_CREDENTIALS.id,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      });
      sessionsRepositoryMock.rotateRefreshToken.mockResolvedValue({
        success: false,
        reason: 'TOKEN_MISMATCH',
      });

      await expect(service.refresh('stale-token', mockReq, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
