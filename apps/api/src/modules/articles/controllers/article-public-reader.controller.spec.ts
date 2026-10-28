import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import { ArticlePublicReaderController } from './article-public-reader.controller.js';
import { ArticlePublicReaderService } from '../services/article-public-reader.service.js';
import { ArticleMediaService } from '../services/article-media.service.js';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator.js';
import { ROLES_KEY } from '../../../common/authorization/decorators/roles.decorator.js';

describe('ArticlePublicReaderController', () => {
  let controller: ArticlePublicReaderController;
  let reflector: Reflector;
  let serviceMock: {
    listPublishedArticles: ReturnType<typeof vi.fn>;
    getPublishedArticleBySlug: ReturnType<typeof vi.fn>;
  };
  let mediaServiceMock: {
    getPublicMediaContent: ReturnType<typeof vi.fn>;
  };

  const proto = ArticlePublicReaderController.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  beforeEach(async () => {
    serviceMock = {
      listPublishedArticles: vi.fn(),
      getPublishedArticleBySlug: vi.fn(),
    };
    mediaServiceMock = {
      getPublicMediaContent: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArticlePublicReaderController],
      providers: [
        Reflector,
        {
          provide: ArticlePublicReaderService,
          useValue: serviceMock,
        },
        {
          provide: ArticleMediaService,
          useValue: mediaServiceMock,
        },
      ],
    }).compile();

    controller = module.get<ArticlePublicReaderController>(
      ArticlePublicReaderController,
    );
    reflector = module.get<Reflector>(Reflector);
  });

  describe('Route security decorators', () => {
    it('decorates listPublishedArticles with @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        proto['listPublishedArticles'],
      );
      expect(isPublic).toBe(true);
    });

    it('decorates getPublishedArticleBySlug with @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        proto['getPublishedArticleBySlug'],
      );
      expect(isPublic).toBe(true);
    });

    it('does NOT apply @Roles() to public endpoints (avoids contradictory configuration)', () => {
      const rolesList = reflector.get<unknown[]>(
        ROLES_KEY,
        proto['listPublishedArticles'],
      );
      expect(rolesList).toBeUndefined();

      const rolesDetail = reflector.get<unknown[]>(
        ROLES_KEY,
        proto['getPublishedArticleBySlug'],
      );
      expect(rolesDetail).toBeUndefined();

      const rolesMedia = reflector.get<unknown[]>(
        ROLES_KEY,
        proto['getPublicMediaContent'],
      );
      expect(rolesMedia).toBeUndefined();
    });

    it('decorates getPublicMediaContent with @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        proto['getPublicMediaContent'],
      );
      expect(isPublic).toBe(true);
    });
  });

  describe('Method delegations', () => {
    it('delegates listPublishedArticles to service', async () => {
      const mockResult = {
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      };
      serviceMock.listPublishedArticles.mockResolvedValue(mockResult);

      const result = await controller.listPublishedArticles({ page: 1, limit: 20 });
      expect(serviceMock.listPublishedArticles).toHaveBeenCalledWith({ page: 1, limit: 20 });
      expect(result).toEqual(mockResult);
    });

    it('delegates getPublishedArticleBySlug to service', async () => {
      const mockResult = {
        id: 'a1111111-0000-4000-8000-000000000001',
        slug: 'test-slug',
        title: 'Test Article',
        summary: null,
        typographyPreset: 'MODERN_SANS',
        cover: null,
        revision: 1,
        publishedAt: '2026-10-25T12:00:00.000Z',
        blocks: [],
      };
      serviceMock.getPublishedArticleBySlug.mockResolvedValue(mockResult);

      const result = await controller.getPublishedArticleBySlug('test-slug');
      expect(serviceMock.getPublishedArticleBySlug).toHaveBeenCalledWith('test-slug');
      expect(result).toEqual(mockResult);
    });

    it('delegates getPublicMediaContent to service and sets security headers', async () => {
      const mediaId = 'm1111111-0000-4000-8000-000000000001';
      const mockContent = {
        buffer: Buffer.from('fake-image-bytes'),
        mimeType: 'image/webp',
        originalFilename: 'diagram.webp',
        fileSize: 16,
      };
      mediaServiceMock.getPublicMediaContent.mockResolvedValue(mockContent);

      const headers: Record<string, string> = {};
      let ended = false;
      const setHeader = vi.fn((key: string, val: string) => {
        headers[key] = val;
      });
      const end = vi.fn((_buf: Buffer) => {
        ended = true;
      });
      const resMock = {
        setHeader,
        end,
      } as unknown as Response;

      await controller.getPublicMediaContent(mediaId, resMock);

      expect(mediaServiceMock.getPublicMediaContent).toHaveBeenCalledWith(mediaId);
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
      expect(setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=300, must-revalidate',
      );
      expect(end).toHaveBeenCalledWith(mockContent.buffer);
      expect(ended).toBe(true);
    });
  });
});
