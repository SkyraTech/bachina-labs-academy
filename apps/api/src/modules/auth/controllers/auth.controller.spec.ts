import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { RegistrationService } from '../services/registration.service.js';
import { UserRole, UserStatus } from '../../users/types/index.js';
import type { SafeUser } from '../../users/types/index.js';
import type { RegisterResponseDto } from '../dto/register-response.dto.js';

/**
 * Unit tests for AuthController.
 *
 * RegistrationService is mocked — no database or crypto calls.
 * Tests verify:
 *   - register() delegates to RegistrationService
 *   - Successful result maps correctly to RegisterResponseDto
 *   - passwordHash is never present in the response
 *   - ConflictException propagates from service to HTTP layer
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

describe('AuthController', () => {
  let controller: AuthController;
  let registrationServiceMock: {
    register: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    registrationServiceMock = {
      register: vi.fn().mockResolvedValue(MOCK_SAFE_USER),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegistrationService, useValue: registrationServiceMock },
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
});
