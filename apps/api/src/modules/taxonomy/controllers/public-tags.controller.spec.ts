import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicTagsController } from './public-tags.controller.js';
import type { TagsService } from '../services/tags.service.js';

describe('PublicTagsController (Unit)', () => {
  let controller: PublicTagsController;
  let service: {
    list: ReturnType<typeof vi.fn>;
    findBySlug: ReturnType<typeof vi.fn>;
  };

  const mockTagDto = {
    id: '22222222-2222-4222-a222-222222222222',
    name: 'NestJS',
    slug: 'nestjs',
    createdAt: new Date('2026-10-28T12:00:00Z'),
    updatedAt: new Date('2026-10-28T12:00:00Z'),
  };

  beforeEach(() => {
    service = {
      list: vi.fn(),
      findBySlug: vi.fn(),
    };
    controller = new PublicTagsController(service as unknown as TagsService);
  });

  it('delegates public listing to tagsService', async () => {
    const paginatedRes = {
      items: [mockTagDto],
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

  it('delegates public lookup by slug to tagsService', async () => {
    service.findBySlug.mockResolvedValue(mockTagDto);

    const res = await controller.findBySlug('nestjs');

    expect(service.findBySlug).toHaveBeenCalledWith('nestjs');
    expect(res).toEqual(mockTagDto);
  });
});

