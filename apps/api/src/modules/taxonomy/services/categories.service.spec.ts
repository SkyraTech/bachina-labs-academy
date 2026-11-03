import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Category } from '@prisma/client';
import { CategoriesService } from './categories.service.js';
import type { CategoriesRepository } from '../repositories/categories.repository.js';

describe('CategoriesService (Unit)', () => {
  let service: CategoriesService;
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    findBySlug: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };

  const mockCategory: Category = {
    id: '11111111-1111-4111-a111-111111111111',
    name: 'Backend Engineering',
    slug: 'backend-engineering',
    description: 'Articles on backend engineering and microservices',
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
    service = new CategoriesService(repo as unknown as CategoriesRepository);
  });

  describe('create', () => {
    it('creates a category when slug is unique', async () => {
      repo.findBySlug.mockResolvedValue(null);
      repo.create.mockResolvedValue(mockCategory);

      const result = await service.create({
        name: 'Backend Engineering',
        slug: 'backend-engineering',
        description: 'Articles on backend engineering and microservices',
      });

      expect(repo.findBySlug).toHaveBeenCalledWith('backend-engineering');
      expect(repo.create).toHaveBeenCalledWith({
        name: 'Backend Engineering',
        slug: 'backend-engineering',
        description: 'Articles on backend engineering and microservices',
      });
      expect(result.id).toBe(mockCategory.id);
      expect(result.name).toBe(mockCategory.name);
      expect(result.slug).toBe(mockCategory.slug);
    });

    it('throws ConflictException on pre-check if slug already exists', async () => {
      repo.findBySlug.mockResolvedValue(mockCategory);

      await expect(
        service.create({
          name: 'Another Backend',
          slug: 'backend-engineering',
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
          name: 'Backend Engineering',
          slug: 'backend-engineering',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('returns category if found', async () => {
      repo.findById.mockResolvedValue(mockCategory);

      const result = await service.findById(mockCategory.id);
      expect(result.id).toBe(mockCategory.id);
    });

    it('throws NotFoundException if category does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.findById('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findBySlug', () => {
    it('returns category if found by slug', async () => {
      repo.findBySlug.mockResolvedValue(mockCategory);

      const result = await service.findBySlug('backend-engineering');
      expect(result.slug).toBe('backend-engineering');
    });

    it('throws NotFoundException if slug not found', async () => {
      repo.findBySlug.mockResolvedValue(null);

      await expect(
        service.findBySlug('unknown-slug'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates a category successfully', async () => {
      repo.findById.mockResolvedValue(mockCategory);
      repo.findBySlug.mockResolvedValue(null);
      const updatedMock = { ...mockCategory, name: 'Advanced Backend' };
      repo.update.mockResolvedValue(updatedMock);

      const result = await service.update(mockCategory.id, {
        name: 'Advanced Backend',
      });

      expect(result.name).toBe('Advanced Backend');
      expect(repo.update).toHaveBeenCalledWith(mockCategory.id, {
        name: 'Advanced Backend',
        slug: undefined,
        description: undefined,
      });
    });

    it('throws BadRequestException if empty update payload is provided', async () => {
      await expect(
        service.update(mockCategory.id, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if category does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if updated slug collides with another category', async () => {
      repo.findById.mockResolvedValue(mockCategory);
      repo.findBySlug.mockResolvedValue({
        ...mockCategory,
        id: '22222222-2222-4222-a222-222222222222',
        slug: 'colliding-slug',
      });

      await expect(
        service.update(mockCategory.id, { slug: 'colliding-slug' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows keeping the same slug on update without collision', async () => {
      repo.findById.mockResolvedValue(mockCategory);
      repo.findBySlug.mockResolvedValue(mockCategory);
      repo.update.mockResolvedValue(mockCategory);

      const result = await service.update(mockCategory.id, {
        slug: 'backend-engineering',
      });

      expect(result.slug).toBe('backend-engineering');
    });

    it('maps concurrent P2002 error to ConflictException', async () => {
      repo.findById.mockResolvedValue(mockCategory);
      repo.findBySlug.mockResolvedValue(null);
      const p2002 = new Prisma.PrismaClientKnownRequestError('Collision', {
        code: 'P2002',
        clientVersion: '6.19.3',
      });
      repo.update.mockRejectedValue(p2002);

      await expect(
        service.update(mockCategory.id, { slug: 'new-slug' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('deletes category if found', async () => {
      repo.findById.mockResolvedValue(mockCategory);
      repo.delete.mockResolvedValue(mockCategory);

      await expect(service.delete(mockCategory.id)).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith(mockCategory.id);
    });

    it('throws NotFoundException if category does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.delete('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('maps concurrent P2025 error to NotFoundException', async () => {
      repo.findById.mockResolvedValue(mockCategory);
      const p2025 = new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '6.19.3',
      });
      repo.delete.mockRejectedValue(p2025);

      await expect(service.delete(mockCategory.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('returns paginated categories with calculated totalPages', async () => {
      repo.list.mockResolvedValue({
        items: [mockCategory],
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

