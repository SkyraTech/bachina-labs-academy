import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ArticleBlockType } from '@prisma/client';
import { ArticlePublicReaderService } from './article-public-reader.service.js';
import { ArticlePublicReaderRepository } from '../repositories/article-public-reader.repository.js';

describe('ArticlePublicReaderService', () => {
  let service: ArticlePublicReaderService;
  let repositoryMock: {
    findPublishedArticles: ReturnType<typeof vi.fn>;
    countPublishedArticles: ReturnType<typeof vi.fn>;
    findPublishedArticleBySlug: ReturnType<typeof vi.fn>;
    findRetainedMediaForSnapshot: ReturnType<typeof vi.fn>;
    findRetainedMediaBatch: ReturnType<typeof vi.fn>;
  };

  const ARTICLE_ID = 'a1111111-0000-4000-8000-000000000001';
  const SNAPSHOT_ID = 's1111111-0000-4000-8000-000000000001';
  const MEDIA_COVER_ID = 'm1111111-0000-4000-8000-000000000001';
  const MEDIA_IMAGE_ID = 'm2222222-0000-4000-8000-000000000002';

  const MOCK_SUMMARY_ROW = {
    articleId: ARTICLE_ID,
    articlePublishedSlug: 'mastering-postgresql',
    articlePublishedRevision: 8,
    articleDraftRevision: 8,
    snapshotId: SNAPSHOT_ID,
    snapshotRevision: 8,
    title: 'Mastering PostgreSQL (Snapshot Title)',
    publishedSlug: 'mastering-postgresql',
    summary: 'A deep dive into ACID transactions.',
    typographyPreset: 'MODERN_SANS',
    coverMediaId: MEDIA_COVER_ID,
    publishedAt: new Date('2026-10-25T12:00:00Z'),
  };

  const MOCK_DETAIL_ROW = {
    ...MOCK_SUMMARY_ROW,
    blocks: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'b2222222-0000-4000-8000-000000000002',
          type: ArticleBlockType.RICH_TEXT,
          position: 1,
          schemaVersion: 1,
          content: { html: '<p>Paragraph content from immutable snapshot.</p>' },
          mediaAssetId: null,
        },
        {
          id: 'b1111111-0000-4000-8000-000000000001',
          type: ArticleBlockType.HEADING,
          position: 0,
          schemaVersion: 1,
          content: { text: 'Section 1: Concurrency', level: 2 },
          mediaAssetId: null,
        },
      ],
    },
  };

  beforeEach(() => {
    repositoryMock = {
      findPublishedArticles: vi.fn(),
      countPublishedArticles: vi.fn(),
      findPublishedArticleBySlug: vi.fn(),
      findRetainedMediaForSnapshot: vi.fn(),
      findRetainedMediaBatch: vi.fn(),
    };

    service = new ArticlePublicReaderService(
      repositoryMock as unknown as ArticlePublicReaderRepository,
    );
  });

  describe('listPublishedArticles', () => {
    it('returns a paginated list of published articles using snapshot metadata and batch cover projection', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([MOCK_SUMMARY_ROW]);
      repositoryMock.countPublishedArticles.mockResolvedValue(1);
      repositoryMock.findRetainedMediaBatch.mockResolvedValue([
        {
          snapshotId: SNAPSHOT_ID,
          mediaAssetId: MEDIA_COVER_ID,
          mediaAsset: {
            id: MEDIA_COVER_ID,
            mimeType: 'image/webp',
            width: 1200,
            height: 630,
            altText: 'Cover Alt',
          },
        },
      ]);

      const result = await service.listPublishedArticles({ page: 1, limit: 20 });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(0, 20);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items).toHaveLength(1);

      const item = result.items[0];
      expect(item.id).toBe(ARTICLE_ID);
      expect(item.slug).toBe('mastering-postgresql');
      expect(item.title).toBe('Mastering PostgreSQL (Snapshot Title)');
      expect(item.summary).toBe('A deep dive into ACID transactions.');
      expect(item.typographyPreset).toBe('MODERN_SANS');
      expect(item.revision).toBe(8);
      expect(item.publishedAt).toBe('2026-10-25T12:00:00.000Z');
      expect(item.cover).toEqual({
        id: MEDIA_COVER_ID,
        mimeType: 'image/webp',
        width: 1200,
        height: 630,
        altText: 'Cover Alt',
        url: `/api/v1/articles/public/media/${MEDIA_COVER_ID}`,
      });
      // Verify storageKey and uploaderId are never exposed
      expect((item.cover as any)?.storageKey).toBeUndefined();
      expect((item.cover as any)?.uploaderId).toBeUndefined();
    });

    it('handles empty published list gracefully', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([]);
      repositoryMock.countPublishedArticles.mockResolvedValue(0);

      const result = await service.listPublishedArticles({});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });

  describe('getPublishedArticleBySlug — validation & lookups', () => {
    it('rejects invalid slug format with 400 Bad Request', async () => {
      await expect(service.getPublishedArticleBySlug('INVALID_SLUG!')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getPublishedArticleBySlug('ab')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns 404 Not Found when published article is not found', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue(null);

      await expect(service.getPublishedArticleBySlug('nonexistent-slug')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('successfully returns published article with ordered immutable blocks', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue(MOCK_DETAIL_ROW);
      repositoryMock.findRetainedMediaForSnapshot.mockResolvedValue([
        {
          snapshotId: SNAPSHOT_ID,
          mediaAssetId: MEDIA_COVER_ID,
          mediaAsset: {
            id: MEDIA_COVER_ID,
            mimeType: 'image/webp',
            width: 1200,
            height: 630,
            altText: 'Cover Image',
          },
        },
      ]);

      const result = await service.getPublishedArticleBySlug('mastering-postgresql');

      expect(result.id).toBe(ARTICLE_ID);
      expect(result.slug).toBe('mastering-postgresql');
      expect(result.title).toBe('Mastering PostgreSQL (Snapshot Title)');
      expect(result.revision).toBe(8);

      // Verify deterministic sorting: position 0 (HEADING) must precede position 1 (RICH_TEXT)
      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[0].position).toBe(0);
      expect(result.blocks[0].type).toBe(ArticleBlockType.HEADING);
      expect(result.blocks[0].content).toEqual({ text: 'Section 1: Concurrency', level: 2 });
      expect(result.blocks[1].position).toBe(1);
      expect(result.blocks[1].type).toBe(ArticleBlockType.RICH_TEXT);
    });
  });

  describe('getPublishedArticleBySlug — media retention verification', () => {
    it('verifies image block media against snapshot retention and projects safely', async () => {
      const detailWithImageBlock = {
        ...MOCK_DETAIL_ROW,
        coverMediaId: null,
        blocks: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'b3333333-0000-4000-8000-000000000003',
              type: ArticleBlockType.IMAGE,
              position: 0,
              schemaVersion: 1,
              content: { caption: 'Architecture diagram' },
              mediaAssetId: MEDIA_IMAGE_ID,
            },
          ],
        },
      };

      repositoryMock.findPublishedArticleBySlug.mockResolvedValue(detailWithImageBlock);
      repositoryMock.findRetainedMediaForSnapshot.mockResolvedValue([
        {
          snapshotId: SNAPSHOT_ID,
          mediaAssetId: MEDIA_IMAGE_ID,
          mediaAsset: {
            id: MEDIA_IMAGE_ID,
            mimeType: 'image/png',
            width: 800,
            height: 600,
            altText: 'Diagram',
          },
        },
      ]);

      const result = await service.getPublishedArticleBySlug('mastering-postgresql');
      expect(result.blocks[0].media).toEqual({
        id: MEDIA_IMAGE_ID,
        mimeType: 'image/png',
        width: 800,
        height: 600,
        altText: 'Diagram',
        url: `/api/v1/articles/public/media/${MEDIA_IMAGE_ID}`,
      });
      expect((result.blocks[0].media as any)?.storageKey).toBeUndefined();
    });

    it('fails closed with 404 if cover media is missing from snapshot retention table', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue(MOCK_DETAIL_ROW);
      // Retention query returns empty -> retention broken!
      repositoryMock.findRetainedMediaForSnapshot.mockResolvedValue([]);

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fails closed with 404 if IMAGE block media is missing from snapshot retention table', async () => {
      const detailWithImageBlock = {
        ...MOCK_DETAIL_ROW,
        coverMediaId: null,
        blocks: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'b3333333-0000-4000-8000-000000000003',
              type: ArticleBlockType.IMAGE,
              position: 0,
              schemaVersion: 1,
              content: { caption: 'Architecture diagram' },
              mediaAssetId: MEDIA_IMAGE_ID,
            },
          ],
        },
      };

      repositoryMock.findPublishedArticleBySlug.mockResolvedValue(detailWithImageBlock);
      repositoryMock.findRetainedMediaForSnapshot.mockResolvedValue([]); // not retained

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPublishedArticleBySlug — snapshot integrity & fail-closed behavior', () => {
    it('fails closed with 404 if snapshot blocks is not an object', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_ROW,
        blocks: 'not-an-object',
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fails closed with 404 if snapshot blocks schemaVersion is missing or invalid', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_ROW,
        blocks: { schemaVersion: 0, blocks: [] },
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fails closed with 404 if snapshot blocks array is missing', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_ROW,
        blocks: { schemaVersion: 1 },
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fails closed with 404 if an IMAGE block has no mediaAssetId', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_ROW,
        blocks: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'b1',
              type: ArticleBlockType.IMAGE,
              position: 0,
              content: { caption: 'Missing media' },
              mediaAssetId: null,
            },
          ],
        },
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fails closed with 404 if a non-IMAGE block contains a mediaAssetId', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_ROW,
        blocks: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'b1',
              type: ArticleBlockType.HEADING,
              position: 0,
              content: { text: 'Heading', level: 2 },
              mediaAssetId: MEDIA_IMAGE_ID,
            },
          ],
        },
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
