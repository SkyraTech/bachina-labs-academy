import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersRepository } from './users.repository.js';
import { UserRole, UserStatus } from './types/index.js';
import type { SafeUser } from './types/index.js';

/**
 * Unit tests for UsersService.
 *
 * UsersRepository is mocked — no database interaction occurs.
 * These tests verify:
 *   - Email normalization (lowercase + trim) is applied before lookups
 *   - findById returns null for missing users without throwing
 *   - findByIdOrThrow throws NotFoundException for missing users
 *   - findByEmail normalizes input before delegating to repository
 *   - Password hash is never present in any returned value
 *   - Dependency injection works correctly
 */

const MOCK_USER: SafeUser = {
  id: '00000000-0000-0000-0000-000000000002',
  email: 'bob@example.com',
  role: UserRole.AUTHOR,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: null,
  createdAt: new Date('2026-10-14T00:00:00Z'),
  updatedAt: new Date('2026-10-14T00:00:00Z'),
};

describe('UsersService', () => {
  let service: UsersService;
  let repositoryMock: {
    findById: ReturnType<typeof vi.fn>;
    findByEmail: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    repositoryMock = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Dependency injection ─────────────────────────────────────────────────────

  describe('dependency injection', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  // ── normalizeEmail ──────────────────────────────────────────────────────────

  describe('normalizeEmail', () => {
    it('converts email to lowercase', () => {
      expect(service.normalizeEmail('Alice@Example.COM')).toBe(
        'alice@example.com',
      );
    });

    it('trims leading and trailing whitespace', () => {
      expect(service.normalizeEmail('  alice@example.com  ')).toBe(
        'alice@example.com',
      );
    });

    it('handles already-normalized input without mutation', () => {
      expect(service.normalizeEmail('bob@example.com')).toBe('bob@example.com');
    });

    it('handles mixed case and whitespace together', () => {
      expect(service.normalizeEmail('  BOB@EXAMPLE.COM  ')).toBe(
        'bob@example.com',
      );
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns SafeUser when user exists', async () => {
      repositoryMock.findById.mockResolvedValue(MOCK_USER);

      const result = await service.findById(MOCK_USER.id);

      expect(result).toEqual(MOCK_USER);
      expect(repositoryMock.findById).toHaveBeenCalledWith(MOCK_USER.id);
    });

    it('returns null when user does not exist', async () => {
      repositoryMock.findById.mockResolvedValue(null);

      const result = await service.findById('non-existent-id');

      expect(result).toBeNull();
    });

    it('does not throw when user is not found', async () => {
      repositoryMock.findById.mockResolvedValue(null);

      await expect(service.findById('non-existent-id')).resolves.toBeNull();
    });
  });

  // ── findByIdOrThrow ──────────────────────────────────────────────────────────

  describe('findByIdOrThrow', () => {
    it('returns SafeUser when user exists', async () => {
      repositoryMock.findById.mockResolvedValue(MOCK_USER);

      const result = await service.findByIdOrThrow(MOCK_USER.id);

      expect(result).toEqual(MOCK_USER);
    });

    it('throws NotFoundException when user does not exist', async () => {
      repositoryMock.findById.mockResolvedValue(null);

      await expect(
        service.findByIdOrThrow('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException with a non-revealing message', async () => {
      repositoryMock.findById.mockResolvedValue(null);

      await expect(
        service.findByIdOrThrow('non-existent-id'),
      ).rejects.toThrow('User not found');
    });

    it('never exposes passwordHash in the returned value', async () => {
      repositoryMock.findById.mockResolvedValue(MOCK_USER);

      const result = await service.findByIdOrThrow(MOCK_USER.id);

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password_hash');
    });
  });

  // ── findByEmail ──────────────────────────────────────────────────────────────

  describe('findByEmail', () => {
    it('returns SafeUser when user exists', async () => {
      repositoryMock.findByEmail.mockResolvedValue(MOCK_USER);

      const result = await service.findByEmail('bob@example.com');

      expect(result).toEqual(MOCK_USER);
    });

    it('normalizes email to lowercase before repository lookup', async () => {
      repositoryMock.findByEmail.mockResolvedValue(MOCK_USER);

      await service.findByEmail('BOB@EXAMPLE.COM');

      expect(repositoryMock.findByEmail).toHaveBeenCalledWith('bob@example.com');
    });

    it('trims whitespace before repository lookup', async () => {
      repositoryMock.findByEmail.mockResolvedValue(MOCK_USER);

      await service.findByEmail('  bob@example.com  ');

      expect(repositoryMock.findByEmail).toHaveBeenCalledWith('bob@example.com');
    });

    it('returns null when user does not exist', async () => {
      repositoryMock.findByEmail.mockResolvedValue(null);

      const result = await service.findByEmail('notfound@example.com');

      expect(result).toBeNull();
    });

    it('never exposes passwordHash in the returned value', async () => {
      repositoryMock.findByEmail.mockResolvedValue(MOCK_USER);

      const result = await service.findByEmail('bob@example.com');

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password_hash');
    });
  });
});
