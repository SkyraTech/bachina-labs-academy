import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicAuthorsService } from './public-authors.service.js';
import { PublicAuthorsRepository } from '../repositories/public-authors.repository.js';
import { ArticlePublicReaderService } from '../../articles/services/article-public-reader.service.js';

describe('PublicAuthorsService', () => {
  let service: PublicAuthorsService;
  let repoMock: {
    findAuthorProfile: ReturnType<typeof vi.fn>;
  };
  let readerServiceMock: {
    listPublishedArticles: ReturnType<typeof vi.fn>;
  };

  const MOCK_AUTHOR_ID = 'a1b2c3d4-1111-4000-8000-000000000001';

  beforeEach(async () => {
    repoMock = {
      findAuthorProfile: vi.fn(),
    };
    readerServiceMock = {
      listPublishedArticles: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicAuthorsService,
        { provide: PublicAuthorsRepository, useValue: repoMock },
        { provide: ArticlePublicReaderService, useValue: readerServiceMock },
      ],
    }).compile();

    service = module.get<PublicAuthorsService>(PublicAuthorsService);
  });

  describe('getAuthorProfile', () => {
    it('1. Public author lookup: returns author profile when author exists', async () => {
      const mockProfile = {
        id: MOCK_AUTHOR_ID,
        displayName: 'Academy Author',
        publishedArticlesCount: 5,
        joinedAt: '2026-10-01T12:00:00.000Z',
      };
      repoMock.findAuthorProfile.mockResolvedValue(mockProfile);

      const result = await service.getAuthorProfile(MOCK_AUTHOR_ID);

      expect(repoMock.findAuthorProfile).toHaveBeenCalledWith(MOCK_AUTHOR_ID);
      expect(result).toEqual(mockProfile);
      // 4. Email exclusion, 5. Password exclusion, 6. Session exclusion
      expect((result as any).email).toBeUndefined();
      expect((result as any).passwordHash).toBeUndefined();
      expect((result as any).sessions).toBeUndefined();
    });

    it('2. Unknown author: throws NotFoundException when author does not exist or is inactive', async () => {
      repoMock.findAuthorProfile.mockResolvedValue(null);

      await expect(service.getAuthorProfile('unknown-author-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listAuthorPublishedArticles', () => {
    it('7. Published-only articles: throws NotFoundException if author does not exist', async () => {
      repoMock.findAuthorProfile.mockResolvedValue(null);

      await expect(
        service.listAuthorPublishedArticles('unknown-author-id', { page: 1, limit: 10 }),
      ).rejects.toThrow(NotFoundException);
      expect(readerServiceMock.listPublishedArticles).not.toHaveBeenCalled();
    });

    it('8. Draft exclusion & 10. Cross-author exclusion: delegates to readerService with authorId filter', async () => {
      repoMock.findAuthorProfile.mockResolvedValue({
        id: MOCK_AUTHOR_ID,
        displayName: 'Academy Author',
        publishedArticlesCount: 2,
        joinedAt: '2026-10-01T12:00:00.000Z',
      });

      const mockResponse = {
        items: [
          {
            id: 'art-1',
            slug: 'published-article-slug',
            title: 'Frozen Title',
            summary: 'Frozen Summary',
            typographyPreset: 'MODERN_SANS',
            cover: null,
            revision: 2,
            publishedAt: '2026-10-25T12:00:00.000Z',
            taxonomyCaptured: true,
            category: null,
            tags: [],
            author: { id: MOCK_AUTHOR_ID, displayName: 'Academy Author' },
          },
        ],
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      };
      readerServiceMock.listPublishedArticles.mockResolvedValue(mockResponse);

      const result = await service.listAuthorPublishedArticles(MOCK_AUTHOR_ID, {
        page: 1,
        limit: 10,
      });

      expect(repoMock.findAuthorProfile).toHaveBeenCalledWith(MOCK_AUTHOR_ID);
      expect(readerServiceMock.listPublishedArticles).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        authorId: MOCK_AUTHOR_ID,
      });
      expect(result).toEqual(mockResponse);
    });
  });
});

