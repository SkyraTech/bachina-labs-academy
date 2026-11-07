import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus } from '@prisma/client';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from '../services/admin-users.service.js';
import { ROLES_KEY } from '../../../common/authorization/decorators/roles.decorator.js';
import { PaginatedAdminUsersResponseDto } from '../dto/paginated-admin-users-response.dto.js';
import { AdminUserItemResponseDto } from '../dto/admin-user-item-response.dto.js';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let service: {
    listUsers: ReturnType<typeof vi.fn>;
    getUserById: ReturnType<typeof vi.fn>;
  };

  const mockUserItem: AdminUserItemResponseDto = {
    id: 'u1-uuid',
    email: 'admin@bachinalabs.com',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    isEmailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  const mockPaginated: PaginatedAdminUsersResponseDto = {
    items: [mockUserItem],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  beforeEach(async () => {
    service = {
      listUsers: vi.fn().mockResolvedValue(mockPaginated),
      getUserById: vi.fn().mockResolvedValue(mockUserItem),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [
        { provide: AdminUsersService, useValue: service },
      ],
    }).compile();

    controller = module.get<AdminUsersController>(AdminUsersController);
  });

  it('requires ADMIN role on the controller', () => {
    const reflector = new Reflector();
    const roles = reflector.get<UserRole[]>(ROLES_KEY, AdminUsersController);
    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('delegates listUsers to AdminUsersService', async () => {
    const query = { page: 1, limit: 20, role: UserRole.AUTHOR };
    const result = await controller.listUsers(query);
    expect(result).toEqual(mockPaginated);
    expect(service.listUsers).toHaveBeenCalledWith(query);
  });

  it('delegates getUserById to AdminUsersService', async () => {
    const result = await controller.getUserById('u1-uuid');
    expect(result).toEqual(mockUserItem);
    expect(service.getUserById).toHaveBeenCalledWith('u1-uuid');
  });
});

