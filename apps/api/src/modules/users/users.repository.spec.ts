import { Test, TestingModule } from '@nestjs/testing';
import { UsersRepository } from './users.repository.js';
import { PrismaService } from '../../database/prisma.service.js';
import { UserRole, UserStatus } from './types/index.js';
import type { SafeUser } from './types/index.js';

/**
 * Unit tests for UsersRepository.
 *
 * PrismaService is mocked — no real database connection is used.
 * These tests verify:
 *   - findById delegates to prisma.user.findUnique with correct args
 *   - findByEmail delegates to prisma.user.findUnique with correct args
 *   - Password hash is never returned in any result
 *   - null is returned when the user is not found
 */

const MOCK_USER: SafeUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'alice@example.com',
  role: UserRole.AUTHOR,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: null,
  createdAt: new Date('2026-10-14T00:00:00Z'),
  updatedAt: new Date('2026-10-14T00:00:00Z'),
};

describe('UsersRepository', () => {
  let repository: UsersRepository;
  let prismaUserMock: {
    findUnique: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prismaUserMock = { findUnique: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersRepository,
        {
          provide: PrismaService,
          useValue: { user: prismaUserMock },
        },
      ],
    }).compile();

    repository = module.get<UsersRepository>(UsersRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns SafeUser when the user exists', async () => {
      prismaUserMock.findUnique.mockResolvedValue(MOCK_USER);

      const result = await repository.findById(MOCK_USER.id);

      expect(result).toEqual(MOCK_USER);
      expect(prismaUserMock.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: MOCK_USER.id } }),
      );
    });

    it('returns null when the user does not exist', async () => {
      prismaUserMock.findUnique.mockResolvedValue(null);

      const result = await repository.findById('non-existent-id');

      expect(result).toBeNull();
    });

    it('does NOT include passwordHash in the select clause', async () => {
      prismaUserMock.findUnique.mockResolvedValue(MOCK_USER);
      await repository.findById(MOCK_USER.id);

      const callArgs = prismaUserMock.findUnique.mock.calls[0][0] as {
        select: Record<string, boolean>;
      };
      expect(callArgs.select).not.toHaveProperty('passwordHash');
      expect(callArgs.select).not.toHaveProperty('password_hash');
    });

    it('queries with correct field selections', async () => {
      prismaUserMock.findUnique.mockResolvedValue(MOCK_USER);
      await repository.findById(MOCK_USER.id);

      const callArgs = prismaUserMock.findUnique.mock.calls[0][0] as {
        select: Record<string, boolean>;
      };
      expect(callArgs.select.id).toBe(true);
      expect(callArgs.select.email).toBe(true);
      expect(callArgs.select.role).toBe(true);
      expect(callArgs.select.status).toBe(true);
      expect(callArgs.select.emailVerifiedAt).toBe(true);
      expect(callArgs.select.createdAt).toBe(true);
      expect(callArgs.select.updatedAt).toBe(true);
    });
  });

  // ── findByEmail ─────────────────────────────────────────────────────────────

  describe('findByEmail', () => {
    it('returns SafeUser when the user exists', async () => {
      prismaUserMock.findUnique.mockResolvedValue(MOCK_USER);

      const result = await repository.findByEmail('alice@example.com');

      expect(result).toEqual(MOCK_USER);
      expect(prismaUserMock.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'alice@example.com' } }),
      );
    });

    it('returns null when the user does not exist', async () => {
      prismaUserMock.findUnique.mockResolvedValue(null);

      const result = await repository.findByEmail('unknown@example.com');

      expect(result).toBeNull();
    });

    it('does NOT include passwordHash in the select clause', async () => {
      prismaUserMock.findUnique.mockResolvedValue(MOCK_USER);
      await repository.findByEmail('alice@example.com');

      const callArgs = prismaUserMock.findUnique.mock.calls[0][0] as {
        select: Record<string, boolean>;
      };
      expect(callArgs.select).not.toHaveProperty('passwordHash');
      expect(callArgs.select).not.toHaveProperty('password_hash');
    });

    it('queries with the supplied email value', async () => {
      prismaUserMock.findUnique.mockResolvedValue(null);
      const testEmail = 'test@example.com';

      await repository.findByEmail(testEmail);

      expect(prismaUserMock.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: testEmail } }),
      );
    });
  });
});
