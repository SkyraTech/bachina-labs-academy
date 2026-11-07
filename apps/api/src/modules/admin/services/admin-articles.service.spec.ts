import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ArticleStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { AdminArticlesService } from './admin-articles.service.js';

describe('AdminArticlesService', () => {
  let service: AdminArticlesService;
  let prismaMock: {
    article: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  const mockArticleRow = {
    id: 'art-1',
    title: 'PostgreSQL 17 Production Tuning',
    draftSlug: 'postgresql-17-production-tuning',
    publishedSlug: 'postgresql-production-tuning',
    summary: 'Buffer pool optimization in PostgreSQL 17',
    status: ArticleStatus.PUBLISHED,
    draftRevision: 2,
    publishedRevision: 1,
    author: { id: 'auth-1', email: 'author@bachinalabs.com' },
    category: { id: 'cat-1', name: 'Database', slug: 'database' },
    createdAt: new Date('2026-01-10T00:00:00.000Z'),
    updatedAt: new Date('2026-01-12T00:00:00.000Z'),
    publishedAt: new Date('2026-01-11T00:00:00.000Z'),
  };

  beforeEach(async () => {
    prismaMock = {
      article: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([mockArticleRow]),
        findUnique: vi.fn().mockResolvedValue(mockArticleRow),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminArticlesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AdminArticlesService>(AdminArticlesService);
  });

  it('lists articles across statuses preserving draft vs published metadata distinctions', async () => {
    const res = await service.listArticles({ page: 1, limit: 20 });
    expect(res.total).toBe(1);
    expect(res.items.length).toBe(1);
    expect(res.items[0].title).toBe('PostgreSQL 17 Production Tuning');
    expect(res.items[0].draftRevision).toBe(2);
    expect(res.items[0].publishedRevision).toBe(1);
    expect(res.items[0].publishedSlug).toBe('postgresql-production-tuning');
    expect(res.items[0].author.email).toBe('author@bachinalabs.com');
  });

  it('filters by status and applies keyword search across title, draftSlug, and summary', async () => {
    await service.listArticles({ page: 1, limit: 20, status: ArticleStatus.PUBLISHED, q: 'tuning' });
    expect(prismaMock.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ArticleStatus.PUBLISHED,
          OR: [
            { title: { contains: 'tuning', mode: 'insensitive' } },
            { summary: { contains: 'tuning', mode: 'insensitive' } },
            { draftSlug: { contains: 'tuning', mode: 'insensitive' } },
          ],
        }),
      }),
    );
  });

  it('retrieves article by id', async () => {
    const res = await service.getArticleById('art-1');
    expect(res.id).toBe('art-1');
    expect(res.title).toBe('PostgreSQL 17 Production Tuning');
  });

  it('throws NotFoundException if article id does not exist', async () => {
    prismaMock.article.findUnique.mockResolvedValue(null);
    await expect(service.getArticleById('missing-art')).rejects.toThrow(NotFoundException);
  });
});

