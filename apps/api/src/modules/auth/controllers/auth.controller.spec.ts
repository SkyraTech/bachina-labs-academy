import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { RegistrationService } from '../services/registration.service.js';
import { EmailVerificationService } from '../services/email-verification.service.js';
import { LoginService } from '../services/login.service.js';
import { LogoutService } from '../services/logout.service.js';
import { UserRole, UserStatus } from '../../users/types/index.js';
import type { SafeUser } from '../../users/types/index.js';
import type { RegisterResponseDto } from '../dto/register-response.dto.js';
import type { AuthenticatedUser } from '../types/jwt.types.js';

/**
 * Unit tests for AuthController.
 */

const MOCK_SAFE_USER: SafeUser = {
  id: 'b1c2d3e4-0000-0000-0000-000000000002',
  email: 'bob@example.com',
  role: UserRole.AUTHOR,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: null,
  createdAt: new Date('2026-10-14T07:00:00.000Z'),
  updatedAt: new Date('2026-10-14T07:00:00.000Z'),
};

const VALID_TOKEN = 'a'.repeat(43);

describe('AuthController', () => {
  let controller: AuthController;
  let registrationServiceMock: {
    register: ReturnType<typeof vi.fn>;
  };
  let emailVerificationServiceMock: {
    verifyEmail: ReturnType<typeof vi.fn>;
    resendVerification: ReturnType<typeof vi.fn>;
  };
  let loginServiceMock: {
    login: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
  let logoutServiceMock: {
    logout: ReturnType<typeof vi.fn>;
    logoutAll: ReturnType<typeof vi.fn>;
    getActiveSessions: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    registrationServiceMock = {
      register: vi.fn().mockResolvedValue(MOCK_SAFE_USER),
    };
    emailVerificationServiceMock = {
      verifyEmail: vi.fn().mockResolvedValue(undefined),
      resendVerification: vi.fn().mockResolvedValue('sent'),
    };
    loginServiceMock = {
      login: vi.fn().mockResolvedValue({
        message: 'Login successful.',
        user: {
          id: MOCK_SAFE_USER.id,
          email: MOCK_SAFE_USER.email,
          role: MOCK_SAFE_USER.role,
          status: MOCK_SAFE_USER.status,
          emailVerifiedAt: new Date(),
        },
      }),
      refresh: vi.fn().mockResolvedValue({
        message: 'Session refreshed successfully.',
      }),
    };
    logoutServiceMock = {
      logout: vi.fn().mockResolvedValue({ message: 'Logged out successfully.' }),
      logoutAll: vi.fn().mockResolvedValue({
        message: 'All sessions logged out successfully.',
        revokedCount: 2,
      }),
      getActiveSessions: vi.fn().mockResolvedValue([]),
      revokeSession: vi.fn().mockResolvedValue({
        message: 'Session revoked successfully.',
        isCurrentSession: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegistrationService, useValue: registrationServiceMock },
        {
          provide: EmailVerificationService,
          useValue: emailVerificationServiceMock,
        },
        {
          provide: LoginService,
          useValue: loginServiceMock,
        },
        {
          provide: LogoutService,
          useValue: logoutServiceMock,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('register()', () => {
    it('returns a RegisterResponseDto on success', async () => {
      const result = await controller.register({
        email: 'bob@example.com',
        password: 'correct-horse-battery-staple',
      });

      expect(result.id).toBe(MOCK_SAFE_USER.id);
      expect(result.email).toBe(MOCK_SAFE_USER.email);
      expect(result.role).toBe(UserRole.AUTHOR);
      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(result.emailVerifiedAt).toBeNull();
    });

    it('delegates to RegistrationService', async () => {
      await controller.register({
        email: 'bob@example.com',
        password: 'correct-horse-battery-staple',
      });

      expect(registrationServiceMock.register).toHaveBeenCalledTimes(1);
    });

    it('does NOT expose passwordHash in the response', async () => {
      const result: RegisterResponseDto = await controller.register({
        email: 'bob@example.com',
        password: 'correct-horse-battery-staple',
      });

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password_hash');
    });

    it('propagates ConflictException from RegistrationService', async () => {
      registrationServiceMock.register.mockRejectedValue(
        new ConflictException('An account with this email address already exists.'),
      );

      await expect(
        controller.register({
          email: 'bob@example.com',
          password: 'correct-horse-battery-staple',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── verifyEmail() ───────────────────────────────────────────────────────────

  describe('verifyEmail()', () => {
    it('returns the fixed success shape', async () => {
      const result = await controller.verifyEmail({ token: VALID_TOKEN });

      expect(result.verified).toBe(true);
      expect(result.message).toBe('Your email address has been verified.');
    });

    it('delegates the presented token to EmailVerificationService', async () => {
      await controller.verifyEmail({ token: VALID_TOKEN });

      expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledTimes(1);
      expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledWith(
        VALID_TOKEN,
      );
    });

    it('never returns the token in the response body', async () => {
      const result = await controller.verifyEmail({ token: VALID_TOKEN });

      expect(JSON.stringify(result)).not.toContain(VALID_TOKEN);
    });

    it('propagates BadRequestException for an invalid token', async () => {
      emailVerificationServiceMock.verifyEmail.mockRejectedValue(
        new BadRequestException('This verification link is invalid or has expired.'),
      );

      await expect(controller.verifyEmail({ token: VALID_TOKEN })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── resendVerification() ────────────────────────────────────────────────────

  describe('resendVerification()', () => {
    it('returns 202 and the generic message', async () => {
      const result = await controller.resendVerification({
        email: 'bob@example.com',
      });

      expect(result.status).toBe(202);
      expect(result.message).toBe(
        'If an account exists for that address, a verification email has been sent.',
      );
    });

    it('delegates the normalized email to EmailVerificationService', async () => {
      await controller.resendVerification({ email: 'bob@example.com' });

      expect(emailVerificationServiceMock.resendVerification).toHaveBeenCalledWith(
        'bob@example.com',
      );
    });

    // This is the enumeration-resistance guarantee: the response must be
    // byte-identical whether the account exists, is already verified, is in
    // cooldown, or the mail transport is down.
    it.each(['sent', 'unknown_email', 'already_verified', 'cooldown_active', 'delivery_failed'] as const)(
      'returns an identical response for internal outcome "%s"',
      async (outcome) => {
        emailVerificationServiceMock.resendVerification.mockResolvedValue(outcome);

        const result = await controller.resendVerification({
          email: 'bob@example.com',
        });

        expect(result.status).toBe(202);
        expect(result.message).toBe(
          'If an account exists for that address, a verification email has been sent.',
        );
      },
    );
  });

  describe('login()', () => {
    it('delegates to LoginService and returns LoginResponseDto', async () => {
      const mockReq = {} as any;
      const mockRes = {} as any;
      const dto = { email: 'bob@example.com', password: 'password123', rememberMe: false };

      const result = await controller.login(dto, mockReq, mockRes);

      expect(loginServiceMock.login).toHaveBeenCalledWith(dto, mockReq, mockRes);
      expect(result.message).toBe('Login successful.');
      expect(result.user.email).toBe(MOCK_SAFE_USER.email);
    });
  });

  describe('refresh()', () => {
    it('reads refresh cookie and delegates to LoginService', async () => {
      const mockReq = { cookies: { academy_refresh: 'raw-refresh-token' } } as any;
      const mockRes = {} as any;

      const result = await controller.refresh(mockReq, mockRes);

      expect(loginServiceMock.refresh).toHaveBeenCalledWith('raw-refresh-token', mockReq, mockRes);
      expect(result.message).toBe('Session refreshed successfully.');
    });
  });

  describe('getCurrentUser()', () => {
    it('maps AuthenticatedUser to CurrentUserResponseDto', () => {
      const authUser: AuthenticatedUser = {
        id: MOCK_SAFE_USER.id,
        email: MOCK_SAFE_USER.email,
        role: MOCK_SAFE_USER.role,
        status: MOCK_SAFE_USER.status,
        emailVerifiedAt: new Date('2026-10-14T08:00:00.000Z'),
        sessionId: 'session-123',
      };

      const result = controller.getCurrentUser(authUser);

      expect(result.id).toBe(authUser.id);
      expect(result.email).toBe(authUser.email);
      expect(result.role).toBe(authUser.role);
      expect(result.status).toBe(authUser.status);
      expect(result.emailVerifiedAt).toEqual(authUser.emailVerifiedAt);
    });
  });

  describe('logout()', () => {
    it('delegates to LogoutService.logout', async () => {
      const mockReq = {} as any;
      const mockRes = {} as any;

      const result = await controller.logout(mockReq, mockRes);

      expect(logoutServiceMock.logout).toHaveBeenCalledWith(mockReq, mockRes);
      expect(result.message).toBe('Logged out successfully.');
    });
  });

  describe('logoutAll()', () => {
    it('delegates to LogoutService.logoutAll with authenticated user', async () => {
      const authUser: AuthenticatedUser = {
        id: MOCK_SAFE_USER.id,
        email: MOCK_SAFE_USER.email,
        role: MOCK_SAFE_USER.role,
        status: MOCK_SAFE_USER.status,
        emailVerifiedAt: new Date(),
        sessionId: 'session-123',
      };
      const mockRes = {} as any;

      const result = await controller.logoutAll(authUser, mockRes);

      expect(logoutServiceMock.logoutAll).toHaveBeenCalledWith(authUser, mockRes);
      expect(result.revokedCount).toBe(2);
    });
  });

  describe('getSessions()', () => {
    it('delegates to LogoutService.getActiveSessions', async () => {
      const authUser: AuthenticatedUser = {
        id: MOCK_SAFE_USER.id,
        email: MOCK_SAFE_USER.email,
        role: MOCK_SAFE_USER.role,
        status: MOCK_SAFE_USER.status,
        emailVerifiedAt: new Date(),
        sessionId: 'session-123',
      };

      const result = await controller.getSessions(authUser);

      expect(logoutServiceMock.getActiveSessions).toHaveBeenCalledWith(authUser);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('revokeSession()', () => {
    it('delegates to LogoutService.revokeSession', async () => {
      const authUser: AuthenticatedUser = {
        id: MOCK_SAFE_USER.id,
        email: MOCK_SAFE_USER.email,
        role: MOCK_SAFE_USER.role,
        status: MOCK_SAFE_USER.status,
        emailVerifiedAt: new Date(),
        sessionId: 'session-123',
      };
      const mockRes = {} as any;

      const result = await controller.revokeSession('session-456', authUser, mockRes);

      expect(logoutServiceMock.revokeSession).toHaveBeenCalledWith(
        'session-456',
        authUser,
        mockRes,
      );
      expect(result.isCurrentSession).toBe(false);
    });
  });
});
