import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service.js';
import { AdminOverviewService } from './admin-overview.service.js';

describe('AdminOverviewService', () => {
  let service: AdminOverviewService;
  let prismaMock: {
    user: { count: ReturnType<typeof vi.fn> };
    article: { count: ReturnType<typeof vi.fn> };
    articleSnapshot: { count: ReturnType<typeof vi.fn> };
    category: { count: ReturnType<typeof vi.fn> };
    tag: { count: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    prismaMock = {
      user: {
        count: vi.fn().mockImplementation((args) => {
          if (!args) return Promise.resolve(10); // totalUsers
          if (args.where?.emailVerifiedAt) return Promise.resolve(8); // verifiedUsers
          if (args.where?.role === 'AUTHOR') return Promise.resolve(9);
          if (args.where?.role === 'ADMIN') return Promise.resolve(1);
          if (args.where?.status === 'ACTIVE') return Promise.resolve(10);
          if (args.where?.status === 'SUSPENDED') return Promise.resolve(0);
          if (args.where?.status === 'DISABLED') return Promise.resolve(0);
          return Promise.resolve(0);
        }),
      },
      article: {
        count: vi.fn().mockImplementation((args) => {
          if (!args) return Promise.resolve(15); // totalArticles
          if (args.where?.status === 'DRAFT') return Promise.resolve(5);
          if (args.where?.status === 'PUBLISHED') return Promise.resolve(10);
          if (args.where?.status === 'ARCHIVED') return Promise.resolve(0);
          return Promise.resolve(0);
        }),
      },
      articleSnapshot: { count: vi.fn().mockResolvedValue(12) },
      category: { count: vi.fn().mockResolvedValue(4) },
      tag: { count: vi.fn().mockResolvedValue(9) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOverviewService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AdminOverviewService>(AdminOverviewService);
  });

  it('aggregates platform counts accurately using database count queries', async () => {
    const res = await service.getOverviewMetrics();

    expect(res.users.total).toBe(10);
    expect(res.users.verified).toBe(8);
    expect(res.users.unverified).toBe(2);
    expect(res.users.byRole.author).toBe(9);
    expect(res.users.byRole.admin).toBe(1);
    expect(res.users.byStatus.active).toBe(10);
    expect(res.users.byStatus.suspended).toBe(0);
    expect(res.users.byStatus.disabled).toBe(0);

    expect(res.articles.total).toBe(15);
    expect(res.articles.draft).toBe(5);
    expect(res.articles.published).toBe(10);
    expect(res.articles.archived).toBe(0);
    expect(res.articles.totalPublishedSnapshots).toBe(12);

    expect(res.taxonomy.totalCategories).toBe(4);
    expect(res.taxonomy.totalTags).toBe(9);
  });
});

