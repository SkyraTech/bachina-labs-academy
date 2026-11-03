import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminCategoriesController } from './admin-categories.controller.js';
import type { CategoriesService } from '../services/categories.service.js';

describe('AdminCategoriesController (Unit)', () => {
  let controller: AdminCategoriesController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  const mockCategoryDto = {
    id: '11111111-1111-4111-a111-111111111111',
    name: 'Backend Development',
    slug: 'backend-development',
    description: 'Articles about backend software',
    createdAt: new Date('2026-10-28T12:00:00Z'),
    updatedAt: new Date('2026-10-28T12:00:00Z'),
  };

  beforeEach(() => {
    service = {
      create: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    controller = new AdminCategoriesController(
      service as unknown as CategoriesService,
    );
  });

  it('delegates create to categoriesService', async () => {
    service.create.mockResolvedValue(mockCategoryDto);

    const dto = {
      name: 'Backend Development',
      slug: 'backend-development',
      description: 'Articles about backend software',
    };
    const res = await controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
    expect(res).toEqual(mockCategoryDto);
  });

  it('delegates list to categoriesService', async () => {
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

  it('delegates findById to categoriesService', async () => {
    service.findById.mockResolvedValue(mockCategoryDto);

    const res = await controller.findById(mockCategoryDto.id);

    expect(service.findById).toHaveBeenCalledWith(mockCategoryDto.id);
    expect(res).toEqual(mockCategoryDto);
  });

  it('delegates update to categoriesService', async () => {
    const updatedDto = { ...mockCategoryDto, name: 'Updated Name' };
    service.update.mockResolvedValue(updatedDto);

    const res = await controller.update(mockCategoryDto.id, {
      name: 'Updated Name',
    });

    expect(service.update).toHaveBeenCalledWith(mockCategoryDto.id, {
      name: 'Updated Name',
    });
    expect(res).toEqual(updatedDto);
  });

  it('delegates delete to categoriesService', async () => {
    service.delete.mockResolvedValue(undefined);

    await controller.delete(mockCategoryDto.id);

    expect(service.delete).toHaveBeenCalledWith(mockCategoryDto.id);
  });
});

