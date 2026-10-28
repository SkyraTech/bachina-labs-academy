import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PublicArticleApiService } from './public-article-api.service';
import { ApiClientService } from '../../../../core/api';
import {
  PublicArticleDetailResponse,
  PublicArticleListResponse,
} from '../models/public-article.models';

describe('PublicArticleApiService', () => {
  let service: PublicArticleApiService;
  let apiClientSpy: { get: ReturnType<typeof vi.fn> };

  const mockListResponse: PublicArticleListResponse = {
    items: [
      {
        id: 'art-1',
        slug: 'intro-to-postgresql',
        title: 'Introduction to PostgreSQL',
        summary: 'Database fundamentals for engineers',
        typographyPreset: 'MODERN_SANS',
        cover: null,
        revision: 1,
        publishedAt: '2026-10-25T12:00:00.000Z',
      },
    ],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };

  const mockDetailResponse: PublicArticleDetailResponse = {
    id: 'art-1',
    slug: 'intro-to-postgresql',
    title: 'Introduction to PostgreSQL',
    summary: 'Database fundamentals for engineers',
    typographyPreset: 'MODERN_SANS',
    cover: null,
    revision: 1,
    publishedAt: '2026-10-25T12:00:00.000Z',
    blocks: [
      {
        id: 'block-1',
        type: 'HEADING',
        position: 0,
        schemaVersion: 1,
        content: { text: 'Overview', level: 2 },
        media: null,
      },
    ],
  };

  beforeEach(() => {
    apiClientSpy = {
      get: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        PublicArticleApiService,
        { provide: ApiClientService, useValue: apiClientSpy },
      ],
    });

    service = TestBed.inject(PublicArticleApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listPublishedArticles', () => {
    it('should call GET articles/public with query parameters', () => {
      apiClientSpy.get.mockReturnValue(of(mockListResponse));

      let result: PublicArticleListResponse | undefined;
      service.listPublishedArticles({ page: 2, limit: 10 }).subscribe((res) => {
        result = res;
      });

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public', {
        params: { page: 2, limit: 10 },
      });
      expect(result).toEqual(mockListResponse);
    });

    it('should call GET articles/public with empty query when no params provided', () => {
      apiClientSpy.get.mockReturnValue(of(mockListResponse));

      service.listPublishedArticles().subscribe();

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public', {
        params: {},
      });
    });

    it('should propagate errors from API client', () => {
      const error = new Error('Network failure');
      apiClientSpy.get.mockReturnValue(throwError(() => error));

      let capturedError: unknown;
      service.listPublishedArticles().subscribe({
        error: (err) => {
          capturedError = err;
        },
      });

      expect(capturedError).toBe(error);
    });
  });

  describe('getPublishedArticleBySlug', () => {
    it('should call GET articles/public/:slug with encoded slug', () => {
      apiClientSpy.get.mockReturnValue(of(mockDetailResponse));

      let result: PublicArticleDetailResponse | undefined;
      service.getPublishedArticleBySlug('intro-to-postgresql').subscribe((res) => {
        result = res;
      });

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public/intro-to-postgresql');
      expect(result).toEqual(mockDetailResponse);
    });

    it('should encode special characters in slug safely', () => {
      apiClientSpy.get.mockReturnValue(of(mockDetailResponse));

      service.getPublishedArticleBySlug('slug with space').subscribe();

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public/slug%20with%20space');
    });

    it('should handle 404 not found errors gracefully', () => {
      const notFoundError = { status: 404, message: 'Article not found.' };
      apiClientSpy.get.mockReturnValue(throwError(() => notFoundError));

      let capturedError: unknown;
      service.getPublishedArticleBySlug('non-existent-slug').subscribe({
        error: (err) => {
          capturedError = err;
        },
      });

      expect(capturedError).toBe(notFoundError);
    });
  });
});
