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
    discoverCategories: ReturnType<typeof vi.fn>;
    discoverTags: ReturnType<typeof vi.fn>;
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
    taxonomy: null,
    isTaxonomySqlNull: true,
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
      findRetainedMediaForSnapshot: vi.fn().mockResolvedValue([]),
      findRetainedMediaBatch: vi.fn().mockResolvedValue([]),
      discoverCategories: vi.fn().mockResolvedValue([]),
      discoverTags: vi.fn().mockResolvedValue([]),
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

  describe('Immutable snapshot taxonomy mapping & validation', () => {
    const CAT_ID = 'c1111111-0000-4000-8000-000000000001';
    const TAG_1_ID = 'b1111111-0000-4000-8000-000000000001';
    const TAG_2_ID = 'b2222222-0000-4000-8000-000000000002';

    const MOCK_DETAIL_BASE = {
      ...MOCK_DETAIL_ROW,
      coverMediaId: null,
      blocks: {
        schemaVersion: 1,
        blocks: [
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

    it('1. maps legacy SQL NULL taxonomy to taxonomyCaptured: false with null category and empty tags', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: null,
        isTaxonomySqlNull: true,
      });

      const result = await service.getPublishedArticleBySlug('mastering-postgresql');
      expect(result.taxonomyCaptured).toBe(false);
      expect(result.category).toBeNull();
      expect(result.tags).toEqual([]);
    });

    it('2. maps structured empty taxonomy to taxonomyCaptured: true with null category and empty tags', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: null,
          tags: [],
        },
        isTaxonomySqlNull: false,
      });

      const result = await service.getPublishedArticleBySlug('mastering-postgresql');
      expect(result.taxonomyCaptured).toBe(true);
      expect(result.category).toBeNull();
      expect(result.tags).toEqual([]);
    });

    it('3. maps Category-only taxonomy correctly', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: {
            id: CAT_ID,
            name: 'Cloud Infrastructure',
            slug: 'cloud-infrastructure',
          },
          tags: [],
        },
        isTaxonomySqlNull: false,
      });

      const result = await service.getPublishedArticleBySlug('mastering-postgresql');
      expect(result.taxonomyCaptured).toBe(true);
      expect(result.category).toEqual({
        id: CAT_ID,
        name: 'Cloud Infrastructure',
        slug: 'cloud-infrastructure',
      });
      expect(result.tags).toEqual([]);
    });

    it('4. maps Tags-only taxonomy correctly', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: null,
          tags: [
            {
              id: TAG_1_ID,
              name: 'PostgreSQL',
              slug: 'postgresql',
            },
          ],
        },
        isTaxonomySqlNull: false,
      });

      const result = await service.getPublishedArticleBySlug('mastering-postgresql');
      expect(result.taxonomyCaptured).toBe(true);
      expect(result.category).toBeNull();
      expect(result.tags).toEqual([
        {
          id: TAG_1_ID,
          name: 'PostgreSQL',
          slug: 'postgresql',
        },
      ]);
    });

    it('5. maps Category and multiple Tags preserving frozen IDs, names, slugs, and deterministic order', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: {
            id: CAT_ID,
            name: 'DevOps & SRE',
            slug: 'devops-and-sre',
          },
          tags: [
            { id: TAG_1_ID, name: 'Ansible', slug: 'ansible' },
            { id: TAG_2_ID, name: 'Kubernetes', slug: 'kubernetes' },
          ],
        },
        isTaxonomySqlNull: false,
      });

      const result = await service.getPublishedArticleBySlug('mastering-postgresql');
      expect(result.taxonomyCaptured).toBe(true);
      expect(result.category).toEqual({
        id: CAT_ID,
        name: 'DevOps & SRE',
        slug: 'devops-and-sre',
      });
      expect(result.tags).toHaveLength(2);
      expect(result.tags[0]).toEqual({
        id: TAG_1_ID,
        name: 'Ansible',
        slug: 'ansible',
      });
      expect(result.tags[1]).toEqual({
        id: TAG_2_ID,
        name: 'Kubernetes',
        slug: 'kubernetes',
      });
    });

    it('6. accepts up to 20 valid tags in snapshot', async () => {
      const twentyTags = Array.from({ length: 20 }, (_, i) => ({
        id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        name: `Tag ${i + 1}`,
        slug: `tag-${i + 1}`,
      }));

      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: null,
          tags: twentyTags,
        },
        isTaxonomySqlNull: false,
      });

      const result = await service.getPublishedArticleBySlug('mastering-postgresql');
      expect(result.taxonomyCaptured).toBe(true);
      expect(result.tags).toHaveLength(20);
    });

    it('7. rejects JSON literal null when distinguishable at persistence boundary (isTaxonomySqlNull = false)', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: null,
        isTaxonomySqlNull: false,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('8. rejects snapshot taxonomy with unknown or non-numeric schemaVersion', async () => {
      // Version 2
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: { schemaVersion: 2, category: null, tags: [] },
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );

      // Version '1' (string)
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: { schemaVersion: '1', category: null, tags: [] },
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );

      // Missing schemaVersion
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: { category: null, tags: [] },
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('9. rejects snapshot taxonomy missing category or tags property', async () => {
      // Missing category
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: { schemaVersion: 1, tags: [] },
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );

      // Missing tags
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: { schemaVersion: 1, category: null },
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('10. rejects snapshot taxonomy where tags is not an array', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: { schemaVersion: 1, category: null, tags: 'not-an-array' },
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('11. rejects snapshot taxonomy with invalid category object (bad id, name, or slug)', async () => {
      // Invalid UUID
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: { id: 'invalid-uuid', name: 'Valid Name', slug: 'valid-slug' },
          tags: [],
        },
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );

      // Invalid slug with uppercase / special chars
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: { id: CAT_ID, name: 'Valid Name', slug: 'INVALID SLUG!' },
          tags: [],
        },
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('12. rejects snapshot taxonomy with duplicate tag IDs', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: null,
          tags: [
            { id: TAG_1_ID, name: 'Tag One', slug: 'tag-one' },
            { id: TAG_1_ID, name: 'Tag Duplicate', slug: 'tag-duplicate' },
          ],
        },
        isTaxonomySqlNull: false,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('13. rejects snapshot taxonomy with more than 20 tags', async () => {
      const twentyOneTags = Array.from({ length: 21 }, (_, i) => ({
        id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        name: `Tag ${i + 1}`,
        slug: `tag-${i + 1}`,
      }));

      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: null,
          tags: twentyOneTags,
        },
        isTaxonomySqlNull: false,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('14. rejects malformed root taxonomy (scalar, array, empty object)', async () => {
      // String scalar
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: 'malformed-string',
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );

      // Array
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: ['item'],
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );

      // Empty object
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {},
        isTaxonomySqlNull: false,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('15. correctly projects taxonomy fields for paginated list items', async () => {
      const rowLegacy = {
        ...MOCK_SUMMARY_ROW,
        articleId: 'a1',
        publishedSlug: 'art-legacy',
        coverMediaId: null,
        taxonomy: null,
        isTaxonomySqlNull: true,
      };
      const rowCaptured = {
        ...MOCK_SUMMARY_ROW,
        articleId: 'a2',
        publishedSlug: 'art-captured',
        coverMediaId: null,
        taxonomy: {
          schemaVersion: 1,
          category: { id: CAT_ID, name: 'Security', slug: 'security' },
          tags: [{ id: TAG_1_ID, name: 'OAuth', slug: 'oauth' }],
        },
        isTaxonomySqlNull: false,
      };

      repositoryMock.findPublishedArticles.mockResolvedValue([rowLegacy, rowCaptured]);
      repositoryMock.countPublishedArticles.mockResolvedValue(2);
      repositoryMock.findRetainedMediaBatch.mockResolvedValue([]);

      const result = await service.listPublishedArticles({ page: 1, limit: 10 });
      expect(result.items).toHaveLength(2);

      // Item 1: Legacy
      expect(result.items[0].id).toBe('a1');
      expect(result.items[0].taxonomyCaptured).toBe(false);
      expect(result.items[0].category).toBeNull();
      expect(result.items[0].tags).toEqual([]);

      // Item 2: Captured
      expect(result.items[1].id).toBe('a2');
      expect(result.items[1].taxonomyCaptured).toBe(true);
      expect(result.items[1].category).toEqual({ id: CAT_ID, name: 'Security', slug: 'security' });
      expect(result.items[1].tags).toEqual([{ id: TAG_1_ID, name: 'OAuth', slug: 'oauth' }]);
    });

    it('16. rejects when isTaxonomySqlNull is undefined or omitted (fails closed with 404)', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: null,
        isTaxonomySqlNull: undefined as any,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('17. rejects when isTaxonomySqlNull is explicit null', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: null,
        isTaxonomySqlNull: null as any,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('18. rejects when isTaxonomySqlNull is string "true"', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: null,
        isTaxonomySqlNull: 'true' as any,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('19. rejects when isTaxonomySqlNull is string "false"', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: { schemaVersion: 1, category: null, tags: [] },
        isTaxonomySqlNull: 'false' as any,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('20. rejects when isTaxonomySqlNull is numeric 0 or 1', async () => {
      // 0
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: null,
        isTaxonomySqlNull: 0 as any,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );

      // 1
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: null,
        isTaxonomySqlNull: 1 as any,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('21. rejects when isTaxonomySqlNull is object or array', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: null,
        isTaxonomySqlNull: {} as any,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );

      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: null,
        isTaxonomySqlNull: [] as any,
      });
      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('22. rejects inconsistent state where isTaxonomySqlNull is true but rawTaxonomy is a populated structured object', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: {
          schemaVersion: 1,
          category: { id: CAT_ID, name: 'Security', slug: 'security' },
          tags: [],
        },
        isTaxonomySqlNull: true,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('23. list endpoint fails closed if any item row has an invalid or missing discriminator', async () => {
      const rowBadDiscriminator = {
        ...MOCK_SUMMARY_ROW,
        articleId: 'a3',
        publishedSlug: 'art-bad-disc',
        coverMediaId: null,
        taxonomy: null,
        isTaxonomySqlNull: undefined as any,
      };

      repositoryMock.findPublishedArticles.mockResolvedValue([rowBadDiscriminator]);
      repositoryMock.countPublishedArticles.mockResolvedValue(1);

      await expect(service.listPublishedArticles({ page: 1, limit: 10 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('24. list endpoint fails closed if any item row has isTaxonomySqlNull === true with structured taxonomy', async () => {
      const rowInconsistent = {
        ...MOCK_SUMMARY_ROW,
        articleId: 'a4',
        publishedSlug: 'art-inconsistent',
        coverMediaId: null,
        taxonomy: { schemaVersion: 1, category: null, tags: [] },
        isTaxonomySqlNull: true,
      };

      repositoryMock.findPublishedArticles.mockResolvedValue([rowInconsistent]);
      repositoryMock.countPublishedArticles.mockResolvedValue(1);

      await expect(service.listPublishedArticles({ page: 1, limit: 10 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('25. rejects when isTaxonomySqlNull is true but rawTaxonomy is undefined (strictly requires explicit null)', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: undefined,
        isTaxonomySqlNull: true,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('26. rejects when isTaxonomySqlNull is true but rawTaxonomy is a string scalar', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: 'invalid-scalar',
        isTaxonomySqlNull: true,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('27. rejects when isTaxonomySqlNull is false and rawTaxonomy is undefined', async () => {
      repositoryMock.findPublishedArticleBySlug.mockResolvedValue({
        ...MOCK_DETAIL_BASE,
        taxonomy: undefined,
        isTaxonomySqlNull: false,
      });

      await expect(service.getPublishedArticleBySlug('mastering-postgresql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('28. list endpoint fails closed if any item row has isTaxonomySqlNull === true with undefined taxonomy', async () => {
      const rowUndefinedTaxonomy = {
        ...MOCK_SUMMARY_ROW,
        articleId: 'a5',
        publishedSlug: 'art-undefined-tax',
        coverMediaId: null,
        taxonomy: undefined as any,
        isTaxonomySqlNull: true,
      };

      repositoryMock.findPublishedArticles.mockResolvedValue([rowUndefinedTaxonomy]);
      repositoryMock.countPublishedArticles.mockResolvedValue(1);

      await expect(service.listPublishedArticles({ page: 1, limit: 10 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Taxonomy Filtering in listPublishedArticles', () => {
    it('passes categorySlug to repository when category filter is provided', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([]);
      repositoryMock.countPublishedArticles.mockResolvedValue(0);

      const result = await service.listPublishedArticles({
        page: 1,
        limit: 20,
        category: 'backend-engineering',
      });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(
        0,
        20,
        'backend-engineering',
        undefined,
      );
      expect(repositoryMock.countPublishedArticles).toHaveBeenCalledWith(
        'backend-engineering',
        undefined,
      );
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('passes tagSlug to repository when tag filter is provided', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([]);
      repositoryMock.countPublishedArticles.mockResolvedValue(0);

      const result = await service.listPublishedArticles({
        page: 1,
        limit: 20,
        tag: 'postgresql',
      });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(
        0,
        20,
        undefined,
        'postgresql',
      );
      expect(repositoryMock.countPublishedArticles).toHaveBeenCalledWith(
        undefined,
        'postgresql',
      );
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('passes both categorySlug and tagSlug when both filters are provided (AND semantics)', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([]);
      repositoryMock.countPublishedArticles.mockResolvedValue(0);

      const result = await service.listPublishedArticles({
        page: 2,
        limit: 10,
        category: 'backend-engineering',
        tag: 'postgresql',
      });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(
        10,
        10,
        'backend-engineering',
        'postgresql',
      );
      expect(repositoryMock.countPublishedArticles).toHaveBeenCalledWith(
        'backend-engineering',
        'postgresql',
      );
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });

    it('omits filter arguments when category and tag are not provided (unfiltered)', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([]);
      repositoryMock.countPublishedArticles.mockResolvedValue(0);

      await service.listPublishedArticles({ page: 1, limit: 20 });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(0, 20);
      expect(repositoryMock.countPublishedArticles).toHaveBeenCalledWith();
    });
  });

  describe('discoverCategories', () => {
    it('returns mapped categories from repository with articleCount', async () => {
      const mockCategoryRows = [
        {
          id: 'c1111111-0000-4000-8000-000000000001',
          name: 'Backend Engineering',
          slug: 'backend-engineering',
          articleCount: 5,
        },
        {
          id: 'c2222222-0000-4000-8000-000000000002',
          name: 'Frontend Systems',
          slug: 'frontend-systems',
          articleCount: 3,
        },
      ];
      repositoryMock.discoverCategories.mockResolvedValue(mockCategoryRows);

      const result = await service.discoverCategories();

      expect(repositoryMock.discoverCategories).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'c1111111-0000-4000-8000-000000000001',
        name: 'Backend Engineering',
        slug: 'backend-engineering',
        articleCount: 5,
      });
      expect(result[1]).toEqual({
        id: 'c2222222-0000-4000-8000-000000000002',
        name: 'Frontend Systems',
        slug: 'frontend-systems',
        articleCount: 3,
      });
    });

    it('returns empty array when no published categories exist', async () => {
      repositoryMock.discoverCategories.mockResolvedValue([]);

      const result = await service.discoverCategories();

      expect(repositoryMock.discoverCategories).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('discoverTags', () => {
    it('returns mapped tags from repository with articleCount', async () => {
      const mockTagRows = [
        {
          id: 't1111111-0000-4000-8000-000000000001',
          name: 'NestJS',
          slug: 'nestjs',
          articleCount: 4,
        },
        {
          id: 't2222222-0000-4000-8000-000000000002',
          name: 'PostgreSQL',
          slug: 'postgresql',
          articleCount: 7,
        },
      ];
      repositoryMock.discoverTags.mockResolvedValue(mockTagRows);

      const result = await service.discoverTags();

      expect(repositoryMock.discoverTags).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 't1111111-0000-4000-8000-000000000001',
        name: 'NestJS',
        slug: 'nestjs',
        articleCount: 4,
      });
      expect(result[1]).toEqual({
        id: 't2222222-0000-4000-8000-000000000002',
        name: 'PostgreSQL',
        slug: 'postgresql',
        articleCount: 7,
      });
    });

    it('returns empty array when no published tags exist', async () => {
      repositoryMock.discoverTags.mockResolvedValue([]);

      const result = await service.discoverTags();

      expect(repositoryMock.discoverTags).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('Search Keyword (q) in listPublishedArticles', () => {
    it('passes trimmed searchTerm to repository when q is provided', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([MOCK_SUMMARY_ROW]);
      repositoryMock.countPublishedArticles.mockResolvedValue(1);

      const result = await service.listPublishedArticles({
        page: 1,
        limit: 20,
        q: '  postgresql  ',
      });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(
        0,
        20,
        undefined,
        undefined,
        'postgresql',
      );
      expect(repositoryMock.countPublishedArticles).toHaveBeenCalledWith(
        undefined,
        undefined,
        'postgresql',
      );
      expect(result.items).toHaveLength(1);
    });

    it('treats empty or whitespace-only q as no search filter', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([]);
      repositoryMock.countPublishedArticles.mockResolvedValue(0);

      await service.listPublishedArticles({
        page: 1,
        limit: 20,
        q: '    ',
      });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(0, 20);
      expect(repositoryMock.countPublishedArticles).toHaveBeenCalledWith();
    });

    it('passes both categorySlug and searchTerm when category and search are combined (AND semantics)', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([]);
      repositoryMock.countPublishedArticles.mockResolvedValue(0);

      await service.listPublishedArticles({
        page: 2,
        limit: 10,
        category: 'backend-engineering',
        q: 'distributed tracing',
      });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(
        10,
        10,
        'backend-engineering',
        undefined,
        'distributed tracing',
      );
      expect(repositoryMock.countPublishedArticles).toHaveBeenCalledWith(
        'backend-engineering',
        undefined,
        'distributed tracing',
      );
    });

    it('passes both tagSlug and searchTerm when tag and search are combined (AND semantics)', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([]);
      repositoryMock.countPublishedArticles.mockResolvedValue(0);

      await service.listPublishedArticles({
        page: 1,
        limit: 20,
        tag: 'postgresql',
        q: 'indexing',
      });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(
        0,
        20,
        undefined,
        'postgresql',
        'indexing',
      );
      expect(repositoryMock.countPublishedArticles).toHaveBeenCalledWith(
        undefined,
        'postgresql',
        'indexing',
      );
    });

    it('passes categorySlug, tagSlug, and searchTerm when all filters are combined (AND semantics)', async () => {
      repositoryMock.findPublishedArticles.mockResolvedValue([]);
      repositoryMock.countPublishedArticles.mockResolvedValue(0);

      await service.listPublishedArticles({
        page: 3,
        limit: 15,
        category: 'backend-engineering',
        tag: 'database',
        q: 'acid transactions',
      });

      expect(repositoryMock.findPublishedArticles).toHaveBeenCalledWith(
        30,
        15,
        'backend-engineering',
        'database',
        'acid transactions',
      );
      expect(repositoryMock.countPublishedArticles).toHaveBeenCalledWith(
        'backend-engineering',
        'database',
        'acid transactions',
      );
    });
  });
});
