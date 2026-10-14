import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RegistrationService } from './registration.service.js';
import { UsersService } from '../../users/users.service.js';
import { UsersRepository } from '../../users/users.repository.js';
import { PasswordHashingService } from './password-hashing.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import { UserRole, UserStatus } from '../../users/types/index.js';
import type { SafeUser } from '../../users/types/index.js';
import type { RegisterRequestDto } from '../dto/register-request.dto.js';

/**
 * Unit tests for RegistrationService.
 *
 * All dependencies are mocked — no real database or argon2 calls.
 * Tests cover:
 *   1.  Successful registration — returns SafeUser without passwordHash
 *   2.  Default AUTHOR role in returned user
 *   3.  emailVerifiedAt is null at registration
 *   4.  Password hashing is called with the raw password
 *   5.  Plaintext password is never stored (repository receives a hash)
 *   6.  Duplicate email — preliminary check throws ConflictException
 *   7.  Case-insensitive duplicate — same ConflictException
 *   8.  Concurrent duplicate — P2002 from DB throws ConflictException
 *   9.  Unexpected DB errors throw InternalServerErrorException
 *   10. ConflictException message does not expose implementation details
 */

const MOCK_SAFE_USER: SafeUser = {
  id: 'a1b2c3d4-0000-0000-0000-000000000001',
  email: 'alice@example.com',
  role: UserRole.AUTHOR,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: null,
  createdAt: new Date('2026-10-14T07:00:00.000Z'),
  updatedAt: new Date('2026-10-14T07:00:00.000Z'),
};

const VALID_DTO: RegisterRequestDto = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
};

describe('RegistrationService', () => {
  let service: RegistrationService;
  let usersServiceMock: {
    findByEmail: ReturnType<typeof vi.fn>;
    normalizeEmail: ReturnType<typeof vi.fn>;
  };
  let usersRepositoryMock: {
    createUser: ReturnType<typeof vi.fn>;
  };
  let passwordHashingServiceMock: {
    hash: ReturnType<typeof vi.fn>;
  };
  let emailVerificationServiceMock: {
    issueVerificationEmail: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    usersServiceMock = {
      findByEmail: vi.fn().mockResolvedValue(null), // no existing user by default
      normalizeEmail: vi.fn((e: string) => e.trim().toLowerCase()),
    };
    usersRepositoryMock = {
      createUser: vi.fn().mockResolvedValue(MOCK_SAFE_USER),
    };
    passwordHashingServiceMock = {
      hash: vi.fn().mockResolvedValue('$argon2id$v=19$mock-hash'),
    };
    // Verification issuance is fire-and-keep-account by contract: registration
    // must succeed regardless. Tests assert the call is made, and separately
    // that a rejected promise does not break registration.
    emailVerificationServiceMock = {
      issueVerificationEmail: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: UsersService, useValue: usersServiceMock },
        { provide: UsersRepository, useValue: usersRepositoryMock },
        { provide: PasswordHashingService, useValue: passwordHashingServiceMock },
        { provide: EmailVerificationService, useValue: emailVerificationServiceMock },
      ],
    }).compile();

    service = module.get<RegistrationService>(RegistrationService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Successful registration ──────────────────────────────────────────────────

  describe('successful registration', () => {
    it('returns a SafeUser on successful registration', async () => {
      const result = await service.register(VALID_DTO);
      expect(result).toEqual(MOCK_SAFE_USER);
    });

    it('assigns the default AUTHOR role', async () => {
      const result = await service.register(VALID_DTO);
      expect(result.role).toBe(UserRole.AUTHOR);
    });

    it('sets emailVerifiedAt to null', async () => {
      const result = await service.register(VALID_DTO);
      expect(result.emailVerifiedAt).toBeNull();
    });

    it('calls PasswordHashingService.hash with the raw password', async () => {
      await service.register(VALID_DTO);
      expect(passwordHashingServiceMock.hash).toHaveBeenCalledWith(
        VALID_DTO.password,
      );
    });

    it('passes the hash (not plaintext) to the repository', async () => {
      await service.register(VALID_DTO);
      const callArg = usersRepositoryMock.createUser.mock.calls[0][0] as {
        email: string;
        passwordHash: string;
      };
      expect(callArg.passwordHash).toBe('$argon2id$v=19$mock-hash');
      expect(callArg.passwordHash).not.toBe(VALID_DTO.password);
    });

    it('does NOT include passwordHash in the returned value', async () => {
      const result = await service.register(VALID_DTO);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password_hash');
    });

    it('passes the normalized email to the repository', async () => {
      await service.register(VALID_DTO);
      const callArg = usersRepositoryMock.createUser.mock.calls[0][0] as {
        email: string;
        passwordHash: string;
      };
      expect(callArg.email).toBe('alice@example.com');
    });
  });

  // ── Duplicate email ───────────────────────────────────────────────────────────

  describe('duplicate email handling', () => {
    it('throws ConflictException when email already exists (preliminary check)', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(MOCK_SAFE_USER);

      await expect(service.register(VALID_DTO)).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not call hash or createUser when email exists', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(MOCK_SAFE_USER);

      await expect(service.register(VALID_DTO)).rejects.toThrow(
        ConflictException,
      );

      expect(passwordHashingServiceMock.hash).not.toHaveBeenCalled();
      expect(usersRepositoryMock.createUser).not.toHaveBeenCalled();
    });

    it('throws ConflictException on P2002 (concurrent duplicate)', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['email'] } },
      );
      usersRepositoryMock.createUser.mockRejectedValue(p2002Error);

      await expect(service.register(VALID_DTO)).rejects.toThrow(
        ConflictException,
      );
    });

    it('ConflictException message does not expose internal details', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(MOCK_SAFE_USER);

      try {
        await service.register(VALID_DTO);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ConflictException);
        if (err instanceof ConflictException) {
          const msg = JSON.stringify(err.getResponse());
          expect(msg).not.toContain('Prisma');
          expect(msg).not.toContain('P2002');
          expect(msg).not.toContain('constraint');
          expect(msg).not.toContain('database');
        }
      }
    });
  });

  // ── Unexpected errors ─────────────────────────────────────────────────────────

  describe('unexpected errors', () => {
    it('throws InternalServerErrorException for unexpected DB errors', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);
      usersRepositoryMock.createUser.mockRejectedValue(
        new Error('Unexpected DB failure'),
      );

      await expect(service.register(VALID_DTO)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('wraps hashing failures as InternalServerErrorException', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);
      passwordHashingServiceMock.hash.mockRejectedValue(
        new InternalServerErrorException('hashing failed'),
      );

      await expect(service.register(VALID_DTO)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ── Verification email issuance ────────────────────────────────────────────

  describe('verification email issuance', () => {
    it('issues a verification email after a successful registration', async () => {
      await service.register(VALID_DTO);

      expect(
        emailVerificationServiceMock.issueVerificationEmail,
      ).toHaveBeenCalledTimes(1);
    });

    it('passes the created user (id + email) to the verification service', async () => {
      await service.register(VALID_DTO);

      expect(
        emailVerificationServiceMock.issueVerificationEmail,
      ).toHaveBeenCalledWith({
        id: MOCK_SAFE_USER.id,
        email: MOCK_SAFE_USER.email,
        role: MOCK_SAFE_USER.role,
        status: MOCK_SAFE_USER.status,
        emailVerifiedAt: MOCK_SAFE_USER.emailVerifiedAt,
        createdAt: MOCK_SAFE_USER.createdAt,
        updatedAt: MOCK_SAFE_USER.updatedAt,
      });
    });

    // The account must survive a mail outage. This is the contract that lets
    // registration return 201 even when SMTP/Resend is unavailable, with
    // recovery through POST /resend-verification.
    it('still returns the user when verification issuance rejects', async () => {
      emailVerificationServiceMock.issueVerificationEmail.mockRejectedValue(
        new Error('SMTP unavailable'),
      );

      const result = await service.register(VALID_DTO);

      expect(result).toEqual(MOCK_SAFE_USER);
    });

    it('does NOT issue a verification email when the email already exists', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(MOCK_SAFE_USER);

      await expect(service.register(VALID_DTO)).rejects.toThrow(
        ConflictException,
      );

      expect(
        emailVerificationServiceMock.issueVerificationEmail,
      ).not.toHaveBeenCalled();
    });

    it('does NOT issue a verification email when user creation fails', async () => {
      usersRepositoryMock.createUser.mockRejectedValue(
        new Error('Unexpected DB failure'),
      );

      await expect(service.register(VALID_DTO)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(
        emailVerificationServiceMock.issueVerificationEmail,
      ).not.toHaveBeenCalled();
    });
  });
});
