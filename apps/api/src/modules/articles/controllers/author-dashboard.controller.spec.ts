import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus, ArticleStatus } from '@prisma/client';
import { AuthorDashboardController } from './author-dashboard.controller.js';
import { AuthorDashboardService } from '../services/author-dashboard.service.js';
import { ROLES_KEY } from '../../../common/authorization/decorators/roles.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('AuthorDashboardController', () => {
  let controller: AuthorDashboardController;
  let reflector: Reflector;
  let serviceMock: {
    getDashboardData: ReturnType<typeof vi.fn>;
  };

  const VALID_AUTHOR: AuthenticatedUser = {
    id: 'a0000000-0000-4000-8000-000000000001',
    email: 'author1@bachinalabs.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-10-15T00:00:00Z'),
    sessionId: 's0000000-0000-4000-8000-000000000001',
  };

  const MOCK_DASHBOARD_DATA = {
    metrics: {
      total: 5,
      draft: 2,
      published: 2,
      archived: 1,
    },
    recentlyUpdated: [
      {
        id: '11111111-1111-4000-8000-000000000001',
        title: 'Draft Scalable Microservices',
        status: ArticleStatus.DRAFT,
        updatedAt: '2026-11-18T10:00:00.000Z',
      },
      {
        id: '11111111-1111-4000-8000-000000000002',
        title: 'Published Database Systems',
        status: ArticleStatus.PUBLISHED,
        updatedAt: '2026-11-18T09:30:00.000Z',
      },
    ],
  };

  beforeEach(async () => {
    serviceMock = {
      getDashboardData: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthorDashboardController],
      providers: [
        { provide: AuthorDashboardService, useValue: serviceMock },
        Reflector,
      ],
    }).compile();

    controller = module.get<AuthorDashboardController>(AuthorDashboardController);
    reflector = module.get<Reflector>(Reflector);
  });

  describe('Route Metadata & Authorization Guards', () => {
    it('should be configured with AUTHOR and ADMIN roles', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, AuthorDashboardController);
      expect(roles).toBeDefined();
      expect(roles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);
    });

    it('should be protected with VerifiedEmailGuard', () => {
      const guards = Reflect.getMetadata('__guards__', AuthorDashboardController);
      expect(guards).toBeDefined();
      expect(guards).toContain(VerifiedEmailGuard);
    });
  });

  describe('getDashboard', () => {
    it('should return authoritative author dashboard data from service', async () => {
      serviceMock.getDashboardData.mockResolvedValueOnce(MOCK_DASHBOARD_DATA);

      const result = await controller.getDashboard(VALID_AUTHOR);

      expect(serviceMock.getDashboardData).toHaveBeenCalledTimes(1);
      expect(serviceMock.getDashboardData).toHaveBeenCalledWith(VALID_AUTHOR);
      expect(result).toEqual(MOCK_DASHBOARD_DATA);
      expect(result.metrics.total).toBe(5);
      expect(result.metrics.draft).toBe(2);
      expect(result.metrics.published).toBe(2);
      expect(result.metrics.archived).toBe(1);
      expect(result.recentlyUpdated).toHaveLength(2);
    });

    it('should pass through errors when service rejects unverified or ineligible account', async () => {
      serviceMock.getDashboardData.mockRejectedValueOnce(new Error('Email verification required.'));

      await expect(controller.getDashboard(VALID_AUTHOR)).rejects.toThrow('Email verification required.');
    });
  });
});
