import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminTagsController } from './admin-tags.controller.js';
import type { TagsService } from '../services/tags.service.js';

describe('AdminTagsController (Unit)', () => {
  let controller: AdminTagsController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
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
      create: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    controller = new AdminTagsController(service as unknown as TagsService);
  });

  it('delegates create to tagsService', async () => {
    service.create.mockResolvedValue(mockTagDto);

    const dto = { name: 'NestJS', slug: 'nestjs' };
    const res = await controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
    expect(res).toEqual(mockTagDto);
  });

  it('delegates list to tagsService', async () => {
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

  it('delegates findById to tagsService', async () => {
    service.findById.mockResolvedValue(mockTagDto);

    const res = await controller.findById(mockTagDto.id);

    expect(service.findById).toHaveBeenCalledWith(mockTagDto.id);
    expect(res).toEqual(mockTagDto);
  });

  it('delegates update to tagsService', async () => {
    const updatedDto = { ...mockTagDto, name: 'Nest.js' };
    service.update.mockResolvedValue(updatedDto);

    const res = await controller.update(mockTagDto.id, { name: 'Nest.js' });

    expect(service.update).toHaveBeenCalledWith(mockTagDto.id, {
      name: 'Nest.js',
    });
    expect(res).toEqual(updatedDto);
  });

  it('delegates delete to tagsService', async () => {
    service.delete.mockResolvedValue(undefined);

    await controller.delete(mockTagDto.id);

    expect(service.delete).toHaveBeenCalledWith(mockTagDto.id);
  });
});

