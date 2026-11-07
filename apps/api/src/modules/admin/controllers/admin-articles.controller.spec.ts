import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole, ArticleStatus } from '@prisma/client';
import { AdminArticlesController } from './admin-articles.controller.js';
import { AdminArticlesService } from '../services/admin-articles.service.js';
import { ROLES_KEY } from '../../../common/authorization/decorators/roles.decorator.js';
import { PaginatedAdminArticlesResponseDto } from '../dto/paginated-admin-articles-response.dto.js';
import { AdminArticleItemResponseDto } from '../dto/admin-article-item-response.dto.js';

describe('AdminArticlesController', () => {
  let controller: AdminArticlesController;
  let service: {
    listArticles: ReturnType<typeof vi.fn>;
    getArticleById: ReturnType<typeof vi.fn>;
  };

  const mockArticleItem: AdminArticleItemResponseDto = {
    id: 'art-uuid-1',
    title: 'High Performance PostgreSQL 17',
    draftSlug: 'high-performance-postgresql-17',
    publishedSlug: 'postgresql-production-tuning',
    summary: 'A deep architectural dive into PostgreSQL 17 memory models.',
    status: ArticleStatus.PUBLISHED,
    draftRevision: 2,
    publishedRevision: 1,
    author: { id: 'auth-uuid', email: 'author@bachinalabs.com' },
    category: { id: 'cat-uuid', name: 'Database', slug: 'database' },
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-01-12T12:00:00.000Z',
    publishedAt: '2026-01-11T11:00:00.000Z',
  };

  const mockPaginated: PaginatedAdminArticlesResponseDto = {
    items: [mockArticleItem],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  beforeEach(async () => {
    service = {
      listArticles: vi.fn().mockResolvedValue(mockPaginated),
      getArticleById: vi.fn().mockResolvedValue(mockArticleItem),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminArticlesController],
      providers: [
        { provide: AdminArticlesService, useValue: service },
      ],
    }).compile();

    controller = module.get<AdminArticlesController>(AdminArticlesController);
  });

  it('requires ADMIN role on the controller', () => {
    const reflector = new Reflector();
    const roles = reflector.get<UserRole[]>(ROLES_KEY, AdminArticlesController);
    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('delegates listArticles to AdminArticlesService', async () => {
    const query = { page: 1, limit: 20, status: ArticleStatus.PUBLISHED };
    const result = await controller.listArticles(query);
    expect(result).toEqual(mockPaginated);
    expect(service.listArticles).toHaveBeenCalledWith(query);
  });

  it('delegates getArticleById to AdminArticlesService', async () => {
    const result = await controller.getArticleById('art-uuid-1');
    expect(result).toEqual(mockArticleItem);
    expect(service.getArticleById).toHaveBeenCalledWith('art-uuid-1');
  });
});

