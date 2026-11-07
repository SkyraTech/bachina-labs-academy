import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AdminOverviewController } from './admin-overview.controller.js';
import { AdminOverviewService } from '../services/admin-overview.service.js';
import { AdminOverviewResponseDto } from '../dto/admin-overview-response.dto.js';
import { ROLES_KEY } from '../../../common/authorization/decorators/roles.decorator.js';

describe('AdminOverviewController', () => {
  let controller: AdminOverviewController;
  let service: {
    getOverviewMetrics: ReturnType<typeof vi.fn>;
  };

  const mockMetrics: AdminOverviewResponseDto = {
    users: {
      total: 10,
      verified: 8,
      unverified: 2,
      byRole: { author: 9, admin: 1 },
      byStatus: { active: 10, suspended: 0, disabled: 0 },
    },
    articles: {
      total: 15,
      draft: 5,
      published: 10,
      archived: 0,
      totalPublishedSnapshots: 12,
    },
    taxonomy: {
      totalCategories: 3,
      totalTags: 8,
    },
  };

  beforeEach(async () => {
    service = {
      getOverviewMetrics: vi.fn().mockResolvedValue(mockMetrics),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminOverviewController],
      providers: [
        { provide: AdminOverviewService, useValue: service },
      ],
    }).compile();

    controller = module.get<AdminOverviewController>(AdminOverviewController);
  });

  it('requires ADMIN role on the controller', () => {
    const reflector = new Reflector();
    const roles = reflector.get<UserRole[]>(ROLES_KEY, AdminOverviewController);
    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('delegates getOverviewMetrics to AdminOverviewService', async () => {
    const result = await controller.getOverviewMetrics();
    expect(result).toEqual(mockMetrics);
    expect(service.getOverviewMetrics).toHaveBeenCalledTimes(1);
  });
});

