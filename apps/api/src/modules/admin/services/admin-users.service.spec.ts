import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { AdminUsersService } from './admin-users.service.js';

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let prismaMock: {
    user: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  const mockUserRow = {
    id: 'u-1',
    email: 'admin@bachinalabs.com',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T12:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  beforeEach(async () => {
    prismaMock = {
      user: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([mockUserRow]),
        findUnique: vi.fn().mockResolvedValue(mockUserRow),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);
  });

  it('lists users with bounded pagination and safe projection excluding passwordHash', async () => {
    const res = await service.listUsers({ page: 1, limit: 20 });
    expect(res.total).toBe(1);
    expect(res.items.length).toBe(1);
    expect(res.items[0].email).toBe('admin@bachinalabs.com');
    expect(res.items[0].isEmailVerified).toBe(true);
    expect((res.items[0] as unknown as Record<string, unknown>)['passwordHash']).toBeUndefined();
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
        select: expect.objectContaining({
          id: true,
          email: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
        }),
      }),
    );
  });

  it('applies search and role filters', async () => {
    await service.listUsers({ page: 1, limit: 20, role: UserRole.ADMIN, q: 'admin' });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: UserRole.ADMIN,
          email: { contains: 'admin', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('retrieves user by id', async () => {
    const res = await service.getUserById('u-1');
    expect(res.id).toBe('u-1');
    expect(res.email).toBe('admin@bachinalabs.com');
  });

  it('throws NotFoundException if user id does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(service.getUserById('missing-id')).rejects.toThrow(NotFoundException);
  });
});

