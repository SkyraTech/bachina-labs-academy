import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaxonomyApiService } from './taxonomy-api.service';
import { ApiClientService } from '../../api/api-client.service';
import {
  Category,
  Tag,
  PaginatedCategories,
  PaginatedTags,
} from '../models/taxonomy.models';

describe('TaxonomyApiService', () => {
  let service: TaxonomyApiService;
  let apiSpy: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  const mockCategories: PaginatedCategories = {
    items: [
      {
        id: 'cat-1',
        name: 'Backend Engineering',
        slug: 'backend-engineering',
        description: 'Backend topics',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    limit: 100,
    totalPages: 1,
  };

  const mockTags: PaginatedTags = {
    items: [
      {
        id: 'tag-1',
        name: 'PostgreSQL',
        slug: 'postgresql',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    limit: 100,
    totalPages: 1,
  };

  beforeEach(() => {
    apiSpy = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        TaxonomyApiService,
        { provide: ApiClientService, useValue: apiSpy },
      ],
    });

    service = TestBed.inject(TaxonomyApiService);
  });

  it('should call GET categories with page and limit params', async () => {
    apiSpy.get.mockReturnValue(of(mockCategories));

    const result = await new Promise((resolve) => {
      service.getCategories(1, 50).subscribe(resolve);
    });

    expect(apiSpy.get).toHaveBeenCalledWith('categories', expect.objectContaining({
      params: expect.anything(),
    }));
    expect(result).toEqual(mockCategories);
  });

  it('should call GET tags with page and limit params', async () => {
    apiSpy.get.mockReturnValue(of(mockTags));

    const result = await new Promise((resolve) => {
      service.getTags(1, 50).subscribe(resolve);
    });

    expect(apiSpy.get).toHaveBeenCalledWith('tags', expect.objectContaining({
      params: expect.anything(),
    }));
    expect(result).toEqual(mockTags);
  });

  it('should call GET admin/categories for admin category listing', async () => {
    apiSpy.get.mockReturnValue(of(mockCategories));

    const result = await new Promise((resolve) => {
      service.getAdminCategories(1, 20).subscribe(resolve);
    });

    expect(apiSpy.get).toHaveBeenCalledWith('admin/categories', expect.objectContaining({
      params: expect.anything(),
    }));
    expect(result).toEqual(mockCategories);
  });

  it('should call POST admin/categories to create category', async () => {
    const newCat: Category = {
      id: 'cat-2',
      name: 'Frontend',
      slug: 'frontend',
      description: null,
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    };
    apiSpy.post.mockReturnValue(of(newCat));

    const result = await new Promise((resolve) => {
      service.createCategory({ name: 'Frontend', slug: 'frontend' }).subscribe(resolve);
    });

    expect(apiSpy.post).toHaveBeenCalledWith('admin/categories', {
      name: 'Frontend',
      slug: 'frontend',
    });
    expect(result).toEqual(newCat);
  });

  it('should call PATCH admin/categories/:id to update category', async () => {
    const updatedCat: Category = {
      id: 'cat-1',
      name: 'Backend Architecture',
      slug: 'backend-architecture',
      description: 'Updated description',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    };
    apiSpy.patch.mockReturnValue(of(updatedCat));

    const result = await new Promise((resolve) => {
      service.updateCategory('cat-1', { name: 'Backend Architecture' }).subscribe(resolve);
    });

    expect(apiSpy.patch).toHaveBeenCalledWith('admin/categories/cat-1', {
      name: 'Backend Architecture',
    });
    expect(result).toEqual(updatedCat);
  });

  it('should call DELETE admin/categories/:id', async () => {
    apiSpy.delete.mockReturnValue(of(undefined));

    await new Promise((resolve) => {
      service.deleteCategory('cat-1').subscribe(resolve);
    });

    expect(apiSpy.delete).toHaveBeenCalledWith('admin/categories/cat-1');
  });

  it('should call POST admin/tags to create tag', async () => {
    const newTag: Tag = {
      id: 'tag-2',
      name: 'TypeScript',
      slug: 'typescript',
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    };
    apiSpy.post.mockReturnValue(of(newTag));

    const result = await new Promise((resolve) => {
      service.createTag({ name: 'TypeScript', slug: 'typescript' }).subscribe(resolve);
    });

    expect(apiSpy.post).toHaveBeenCalledWith('admin/tags', {
      name: 'TypeScript',
      slug: 'typescript',
    });
    expect(result).toEqual(newTag);
  });

  it('should call PATCH admin/tags/:id to update tag', async () => {
    const updatedTag: Tag = {
      id: 'tag-1',
      name: 'PostgreSQL DB',
      slug: 'postgresql-db',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    };
    apiSpy.patch.mockReturnValue(of(updatedTag));

    const result = await new Promise((resolve) => {
      service.updateTag('tag-1', { name: 'PostgreSQL DB' }).subscribe(resolve);
    });

    expect(apiSpy.patch).toHaveBeenCalledWith('admin/tags/tag-1', {
      name: 'PostgreSQL DB',
    });
    expect(result).toEqual(updatedTag);
  });

  it('should call DELETE admin/tags/:id', async () => {
    apiSpy.delete.mockReturnValue(of(undefined));

    await new Promise((resolve) => {
      service.deleteTag('tag-1').subscribe(resolve);
    });

    expect(apiSpy.delete).toHaveBeenCalledWith('admin/tags/tag-1');
  });
});

