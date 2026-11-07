import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicAuthorsController } from './public-authors.controller.js';
import { PublicAuthorsService } from '../services/public-authors.service.js';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator.js';
import { Reflector } from '@nestjs/core';

describe('PublicAuthorsController', () => {
  let controller: PublicAuthorsController;
  let serviceMock: {
    getAuthorProfile: ReturnType<typeof vi.fn>;
    listAuthorPublishedArticles: ReturnType<typeof vi.fn>;
  };
  let reflector: Reflector;

  const MOCK_AUTHOR_ID = 'a1b2c3d4-1111-4000-8000-000000000001';

  beforeEach(async () => {
    serviceMock = {
      getAuthorProfile: vi.fn(),
      listAuthorPublishedArticles: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicAuthorsController],
      providers: [
        {
          provide: PublicAuthorsService,
          useValue: serviceMock,
        },
        Reflector,
      ],
    }).compile();

    controller = module.get<PublicAuthorsController>(PublicAuthorsController);
    reflector = module.get<Reflector>(Reflector);
  });

  describe('Route metadata & security', () => {
    it('14. Access without login: decorates getAuthorProfile with @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.getAuthorProfile,
      );
      expect(isPublic).toBe(true);
    });

    it('14. Access without login: decorates listAuthorPublishedArticles with @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.listAuthorPublishedArticles,
      );
      expect(isPublic).toBe(true);
    });
  });

  describe('getAuthorProfile', () => {
    it('1. delegates to service.getAuthorProfile with authorId and returns result', async () => {
      const mockProfile = {
        id: MOCK_AUTHOR_ID,
        displayName: 'Academy Author',
        publishedArticlesCount: 3,
        joinedAt: '2026-10-25T12:00:00.000Z',
      };
      serviceMock.getAuthorProfile.mockResolvedValue(mockProfile);

      const result = await controller.getAuthorProfile(MOCK_AUTHOR_ID);

      expect(serviceMock.getAuthorProfile).toHaveBeenCalledWith(MOCK_AUTHOR_ID);
      expect(result).toEqual(mockProfile);
    });
  });

  describe('listAuthorPublishedArticles', () => {
    it('7. delegates to service.listAuthorPublishedArticles with authorId and query', async () => {
      const mockList = {
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      };
      serviceMock.listAuthorPublishedArticles.mockResolvedValue(mockList);

      const query = { page: 1, limit: 10 };
      const result = await controller.listAuthorPublishedArticles(MOCK_AUTHOR_ID, query);

      expect(serviceMock.listAuthorPublishedArticles).toHaveBeenCalledWith(MOCK_AUTHOR_ID, query);
      expect(result).toEqual(mockList);
    });
  });
});

