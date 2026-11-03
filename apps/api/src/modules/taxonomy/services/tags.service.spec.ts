import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tag } from '@prisma/client';
import { TagsService } from './tags.service.js';
import type { TagsRepository } from '../repositories/tags.repository.js';

describe('TagsService (Unit)', () => {
  let service: TagsService;
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    findBySlug: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };

  const mockTag: Tag = {
    id: '22222222-2222-4222-a222-222222222222',
    name: 'NestJS',
    slug: 'nestjs',
    createdAt: new Date('2026-10-28T12:00:00Z'),
    updatedAt: new Date('2026-10-28T12:00:00Z'),
  };

  beforeEach(() => {
    repo = {
      findById: vi.fn(),
      findBySlug: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };
    service = new TagsService(repo as unknown as TagsRepository);
  });

  describe('create', () => {
    it('creates a tag when slug is unique', async () => {
      repo.findBySlug.mockResolvedValue(null);
      repo.create.mockResolvedValue(mockTag);

      const result = await service.create({
        name: 'NestJS',
        slug: 'nestjs',
      });

      expect(repo.findBySlug).toHaveBeenCalledWith('nestjs');
      expect(repo.create).toHaveBeenCalledWith({
        name: 'NestJS',
        slug: 'nestjs',
      });
      expect(result.id).toBe(mockTag.id);
      expect(result.name).toBe(mockTag.name);
      expect(result.slug).toBe(mockTag.slug);
    });

    it('throws ConflictException on pre-check if slug already exists', async () => {
      repo.findBySlug.mockResolvedValue(mockTag);

      await expect(
        service.create({
          name: 'Another NestJS',
          slug: 'nestjs',
        }),
      ).rejects.toThrow(ConflictException);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('maps Prisma P2002 uniqueness error to ConflictException on concurrent creation', async () => {
      repo.findBySlug.mockResolvedValue(null);
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`slug`)',
        { code: 'P2002', clientVersion: '6.19.3' },
      );
      repo.create.mockRejectedValue(p2002Error);

      await expect(
        service.create({
          name: 'NestJS',
          slug: 'nestjs',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('returns tag if found', async () => {
      repo.findById.mockResolvedValue(mockTag);

      const result = await service.findById(mockTag.id);
      expect(result.id).toBe(mockTag.id);
    });

    it('throws NotFoundException if tag does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.findById('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findBySlug', () => {
    it('returns tag if found by slug', async () => {
      repo.findBySlug.mockResolvedValue(mockTag);

      const result = await service.findBySlug('nestjs');
      expect(result.slug).toBe('nestjs');
    });

    it('throws NotFoundException if slug not found', async () => {
      repo.findBySlug.mockResolvedValue(null);

      await expect(service.findBySlug('unknown-slug')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates a tag successfully', async () => {
      repo.findById.mockResolvedValue(mockTag);
      repo.findBySlug.mockResolvedValue(null);
      const updatedMock = { ...mockTag, name: 'NestJS Framework' };
      repo.update.mockResolvedValue(updatedMock);

      const result = await service.update(mockTag.id, {
        name: 'NestJS Framework',
      });

      expect(result.name).toBe('NestJS Framework');
      expect(repo.update).toHaveBeenCalledWith(mockTag.id, {
        name: 'NestJS Framework',
        slug: undefined,
      });
    });

    it('throws BadRequestException if empty update payload is provided', async () => {
      await expect(service.update(mockTag.id, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if tag does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if updated slug collides with another tag', async () => {
      repo.findById.mockResolvedValue(mockTag);
      repo.findBySlug.mockResolvedValue({
        ...mockTag,
        id: '33333333-3333-4333-a333-333333333333',
        slug: 'colliding-slug',
      });

      await expect(
        service.update(mockTag.id, { slug: 'colliding-slug' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows keeping the same slug on update without collision', async () => {
      repo.findById.mockResolvedValue(mockTag);
      repo.findBySlug.mockResolvedValue(mockTag);
      repo.update.mockResolvedValue(mockTag);

      const result = await service.update(mockTag.id, {
        slug: 'nestjs',
      });

      expect(result.slug).toBe('nestjs');
    });

    it('maps concurrent P2002 error to ConflictException', async () => {
      repo.findById.mockResolvedValue(mockTag);
      repo.findBySlug.mockResolvedValue(null);
      const p2002 = new Prisma.PrismaClientKnownRequestError('Collision', {
        code: 'P2002',
        clientVersion: '6.19.3',
      });
      repo.update.mockRejectedValue(p2002);

      await expect(
        service.update(mockTag.id, { slug: 'new-slug' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('deletes tag if found', async () => {
      repo.findById.mockResolvedValue(mockTag);
      repo.delete.mockResolvedValue(mockTag);

      await expect(service.delete(mockTag.id)).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith(mockTag.id);
    });

    it('throws NotFoundException if tag does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.delete('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('maps concurrent P2025 error to NotFoundException', async () => {
      repo.findById.mockResolvedValue(mockTag);
      const p2025 = new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '6.19.3',
      });
      repo.delete.mockRejectedValue(p2025);

      await expect(service.delete(mockTag.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('returns paginated tags with calculated totalPages', async () => {
      repo.list.mockResolvedValue({
        items: [mockTag],
        total: 1,
      });

      const result = await service.list({ page: 1, limit: 10 });

      expect(result.items.length).toBe(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
    });

    it('returns empty list and totalPages 0 when total is 0', async () => {
      repo.list.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await service.list({ page: 1, limit: 20 });

      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });
});

