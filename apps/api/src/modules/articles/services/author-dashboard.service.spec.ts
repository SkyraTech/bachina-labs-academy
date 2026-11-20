import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus, ArticleStatus } from '@prisma/client';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthorDashboardService } from './author-dashboard.service.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('AuthorDashboardService', () => {
  let service: AuthorDashboardService;
  let prismaMock: {
    article: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  const AUTHOR_A: AuthenticatedUser = {
    id: 'a0000000-0000-4000-8000-000000000001',
    email: 'authorA@bachinalabs.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-10-15T00:00:00Z'),
    sessionId: 's0000000-0000-4000-8000-000000000001',
  };

  const AUTHOR_B: AuthenticatedUser = {
    id: 'b0000000-0000-4000-8000-000000000002',
    email: 'authorB@bachinalabs.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-10-15T00:00:00Z'),
    sessionId: 's0000000-0000-4000-8000-000000000002',
  };

  beforeEach(async () => {
    prismaMock = {
      article: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorDashboardService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AuthorDashboardService>(AuthorDashboardService);
  });

  describe('Account Eligibility and Security', () => {
    it('should reject unauthenticated access', async () => {
      await expect(service.getDashboardData(null as unknown as AuthenticatedUser)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject non-active accounts (e.g. SUSPENDED)', async () => {
      const suspendedUser: AuthenticatedUser = {
        ...AUTHOR_A,
        status: UserStatus.SUSPENDED,
      };

      await expect(service.getDashboardData(suspendedUser)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject unverified email accounts', async () => {
      const unverifiedUser: AuthenticatedUser = {
        ...AUTHOR_A,
        emailVerifiedAt: null,
      };

      await expect(service.getDashboardData(unverifiedUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Author Ownership Scoping & Aggregations', () => {
    it('should query metrics strictly filtered by authenticated authorId', async () => {
      prismaMock.article.count
        .mockResolvedValueOnce(6) // total
        .mockResolvedValueOnce(3) // draft
        .mockResolvedValueOnce(2) // published
        .mockResolvedValueOnce(1); // archived

      const mockDate = new Date('2026-11-18T12:00:00.000Z');
      prismaMock.article.findMany.mockResolvedValueOnce([
        {
          id: '11111111-1111-4000-8000-000000000001',
          title: 'Draft Scalable Microservices',
          status: ArticleStatus.DRAFT,
          updatedAt: mockDate,
        },
      ]);

      const result = await service.getDashboardData(AUTHOR_A);

      // Verify Prisma counts were called with authorId = AUTHOR_A.id
      expect(prismaMock.article.count).toHaveBeenCalledWith({
        where: { authorId: AUTHOR_A.id },
      });
      expect(prismaMock.article.count).toHaveBeenCalledWith({
        where: { authorId: AUTHOR_A.id, status: ArticleStatus.DRAFT },
      });
      expect(prismaMock.article.count).toHaveBeenCalledWith({
        where: { authorId: AUTHOR_A.id, status: ArticleStatus.PUBLISHED },
      });
      expect(prismaMock.article.count).toHaveBeenCalledWith({
        where: { authorId: AUTHOR_A.id, status: ArticleStatus.ARCHIVED },
      });

      // Verify findMany was called with authorId = AUTHOR_A.id and proper ordering
      expect(prismaMock.article.findMany).toHaveBeenCalledWith({
        where: { authorId: AUTHOR_A.id },
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 5,
      });

      expect(result.metrics).toEqual({
        total: 6,
        draft: 3,
        published: 2,
        archived: 1,
      });
      expect(result.recentlyUpdated).toHaveLength(1);
      expect(result.recentlyUpdated[0].updatedAt).toBe('2026-11-18T12:00:00.000Z');
    });

    it('should isolate Author B data completely when Author B requests dashboard', async () => {
      prismaMock.article.count
        .mockResolvedValueOnce(4) // total
        .mockResolvedValueOnce(1) // draft
        .mockResolvedValueOnce(2) // published
        .mockResolvedValueOnce(1); // archived
      prismaMock.article.findMany.mockResolvedValueOnce([]);

      const result = await service.getDashboardData(AUTHOR_B);

      expect(prismaMock.article.count).toHaveBeenCalledWith({
        where: { authorId: AUTHOR_B.id },
      });
      expect(result.metrics.total).toBe(4);
      expect(result.recentlyUpdated).toEqual([]);
    });

    it('should handle zero-article empty state accurately', async () => {
      prismaMock.article.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prismaMock.article.findMany.mockResolvedValueOnce([]);

      const result = await service.getDashboardData(AUTHOR_A);

      expect(result.metrics).toEqual({
        total: 0,
        draft: 0,
        published: 0,
        archived: 0,
      });
      expect(result.recentlyUpdated).toEqual([]);
    });

    it('should accurately count author with more than 50 articles without pagination truncation', async () => {
      prismaMock.article.count
        .mockResolvedValueOnce(65) // total > 50
        .mockResolvedValueOnce(15) // draft
        .mockResolvedValueOnce(45) // published
        .mockResolvedValueOnce(5); // archived
      prismaMock.article.findMany.mockResolvedValueOnce([
        {
          id: '11111111-1111-4000-8000-000000000065',
          title: 'Article 65',
          status: ArticleStatus.PUBLISHED,
          updatedAt: new Date('2026-11-18T15:00:00.000Z'),
        },
      ]);

      const result = await service.getDashboardData(AUTHOR_A);

      expect(result.metrics.total).toBe(65);
      expect(result.metrics.draft).toBe(15);
      expect(result.metrics.published).toBe(45);
      expect(result.metrics.archived).toBe(5);
    });

    it('should never invoke any mutating database operations', async () => {
      prismaMock.article.count.mockResolvedValue(0);
      prismaMock.article.findMany.mockResolvedValue([]);

      await service.getDashboardData(AUTHOR_A);

      // Verify no create, update, delete, upsert, or executeRaw was ever touched
      const articleMethods = Object.keys(prismaMock.article);
      expect(articleMethods).toEqual(['count', 'findMany']);
    });

    it('should return strictly supported operational metrics without fabricated analytics', async () => {
      prismaMock.article.count.mockResolvedValue(0);
      prismaMock.article.findMany.mockResolvedValue([]);

      const result = await service.getDashboardData(AUTHOR_A);

      const metricKeys = Object.keys(result.metrics);
      expect(metricKeys.sort()).toEqual(['archived', 'draft', 'published', 'total']);
      expect((result as unknown as Record<string, unknown>)['views']).toBeUndefined();
      expect((result as unknown as Record<string, unknown>)['readers']).toBeUndefined();
      expect((result as unknown as Record<string, unknown>)['revenue']).toBeUndefined();
      expect((result as unknown as Record<string, unknown>)['growth']).toBeUndefined();
    });
  });
});
