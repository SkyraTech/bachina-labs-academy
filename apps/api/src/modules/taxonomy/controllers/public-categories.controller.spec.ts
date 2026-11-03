import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicCategoriesController } from './public-categories.controller.js';
import type { CategoriesService } from '../services/categories.service.js';

describe('PublicCategoriesController (Unit)', () => {
  let controller: PublicCategoriesController;
  let service: {
    list: ReturnType<typeof vi.fn>;
    findBySlug: ReturnType<typeof vi.fn>;
  };

  const mockCategoryDto = {
    id: '11111111-1111-4111-a111-111111111111',
    name: 'Backend Development',
    slug: 'backend-development',
    description: 'Articles on backend software',
    createdAt: new Date('2026-10-28T12:00:00Z'),
    updatedAt: new Date('2026-10-28T12:00:00Z'),
  };

  beforeEach(() => {
    service = {
      list: vi.fn(),
      findBySlug: vi.fn(),
    };
    controller = new PublicCategoriesController(
      service as unknown as CategoriesService,
    );
  });

  it('delegates public listing to categoriesService', async () => {
    const paginatedRes = {
      items: [mockCategoryDto],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    };
    service.list.mockResolvedValue(paginatedRes);

    const res = await controller.list({ page: 1, limit: 20 });

    expect(service.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(res).toEqual(paginatedRes);
  });

  it('delegates public lookup by slug to categoriesService', async () => {
    service.findBySlug.mockResolvedValue(mockCategoryDto);

    const res = await controller.findBySlug('backend-development');

    expect(service.findBySlug).toHaveBeenCalledWith('backend-development');
    expect(res).toEqual(mockCategoryDto);
  });
});

