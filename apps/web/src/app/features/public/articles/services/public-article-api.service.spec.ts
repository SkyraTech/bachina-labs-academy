import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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
        taxonomyCaptured: true,
        category: null,
        tags: [],
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
    taxonomyCaptured: true,
    category: null,
    tags: [],
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

    it('should include category and tag query parameters when provided', () => {
      apiClientSpy.get.mockReturnValue(of(mockListResponse));

      service
        .listPublishedArticles({
          page: 1,
          limit: 10,
          category: 'backend-engineering',
          tag: 'postgresql',
        })
        .subscribe();

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public', {
        params: {
          page: 1,
          limit: 10,
          category: 'backend-engineering',
          tag: 'postgresql',
        },
      });
    });

    it('should trim category and tag parameters and omit empty strings', () => {
      apiClientSpy.get.mockReturnValue(of(mockListResponse));

      service
        .listPublishedArticles({
          category: '  devops  ',
          tag: '   ',
        })
        .subscribe();

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public', {
        params: {
          category: 'devops',
        },
      });
    });

    it('should include q query parameter when provided and trim leading/trailing whitespace', () => {
      apiClientSpy.get.mockReturnValue(of(mockListResponse));

      service
        .listPublishedArticles({
          page: 1,
          limit: 20,
          q: '  database indexing  ',
        })
        .subscribe();

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public', {
        params: {
          page: 1,
          limit: 20,
          q: 'database indexing',
        },
      });
    });

    it('should omit q parameter when whitespace-only or empty', () => {
      apiClientSpy.get.mockReturnValue(of(mockListResponse));

      service
        .listPublishedArticles({
          page: 1,
          limit: 20,
          q: '     ',
        })
        .subscribe();

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public', {
        params: {
          page: 1,
          limit: 20,
        },
      });
    });

    it('should combine q, category, tag, and page parameters simultaneously', () => {
      apiClientSpy.get.mockReturnValue(of(mockListResponse));

      service
        .listPublishedArticles({
          page: 2,
          limit: 10,
          category: 'backend-engineering',
          tag: 'postgresql',
          q: 'concurrency',
        })
        .subscribe();

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public', {
        params: {
          page: 2,
          limit: 10,
          category: 'backend-engineering',
          tag: 'postgresql',
          q: 'concurrency',
        },
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

  describe('getPublishedCategories', () => {
    it('should call GET articles/public/taxonomy/categories', () => {
      const mockCategories = [
        {
          id: 'cat-1',
          name: 'Backend Engineering',
          slug: 'backend-engineering',
          articleCount: 5,
        },
      ];
      apiClientSpy.get.mockReturnValue(of(mockCategories));

      let result: unknown;
      service.getPublishedCategories().subscribe((res) => {
        result = res;
      });

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public/taxonomy/categories');
      expect(result).toEqual(mockCategories);
    });

    it('should propagate errors when category discovery fails', () => {
      const error = new Error('Discovery error');
      apiClientSpy.get.mockReturnValue(throwError(() => error));

      let capturedError: unknown;
      service.getPublishedCategories().subscribe({
        error: (err) => {
          capturedError = err;
        },
      });

      expect(capturedError).toBe(error);
    });
  });

  describe('getPublishedTags', () => {
    it('should call GET articles/public/taxonomy/tags', () => {
      const mockTags = [
        {
          id: 'tag-1',
          name: 'PostgreSQL',
          slug: 'postgresql',
          articleCount: 3,
        },
      ];
      apiClientSpy.get.mockReturnValue(of(mockTags));

      let result: unknown;
      service.getPublishedTags().subscribe((res) => {
        result = res;
      });

      expect(apiClientSpy.get).toHaveBeenCalledWith('articles/public/taxonomy/tags');
      expect(result).toEqual(mockTags);
    });

    it('should propagate errors when tag discovery fails', () => {
      const error = new Error('Tag error');
      apiClientSpy.get.mockReturnValue(throwError(() => error));

      let capturedError: unknown;
      service.getPublishedTags().subscribe({
        error: (err) => {
          capturedError = err;
        },
      });

      expect(capturedError).toBe(error);
    });
  });

  describe('Canonical Outgoing HTTP Requests (Integration)', () => {
    let httpTesting: HttpTestingController;
    let integratedService: PublicArticleApiService;

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          ApiClientService,
          PublicArticleApiService,
        ],
      });
      integratedService = TestBed.inject(PublicArticleApiService);
      httpTesting = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
      httpTesting.verify();
    });

    it('should dispatch canonical GET /api/v1/articles/public/taxonomy/categories for category discovery', () => {
      integratedService.getPublishedCategories().subscribe();
      const req = httpTesting.expectOne('/api/v1/articles/public/taxonomy/categories');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should dispatch canonical GET /api/v1/articles/public/taxonomy/tags for tag discovery', () => {
      integratedService.getPublishedTags().subscribe();
      const req = httpTesting.expectOne('/api/v1/articles/public/taxonomy/tags');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should dispatch canonical GET /api/v1/articles/public with query parameters for filtered list', () => {
      integratedService
        .listPublishedArticles({
          page: 2,
          limit: 20,
          category: 'backend-engineering',
          tag: 'postgresql',
        })
        .subscribe();
      const req = httpTesting.expectOne(
        '/api/v1/articles/public?page=2&limit=20&category=backend-engineering&tag=postgresql',
      );
      expect(req.request.method).toBe('GET');
      req.flush({ items: [], page: 2, limit: 20, total: 0, totalPages: 0 });
    });

    it('should dispatch canonical GET /api/v1/articles/public/:slug for article detail', () => {
      integratedService.getPublishedArticleBySlug('high-performance-sql-indexing').subscribe();
      const req = httpTesting.expectOne('/api/v1/articles/public/high-performance-sql-indexing');
      expect(req.request.method).toBe('GET');
      req.flush({ id: 'art-1', slug: 'high-performance-sql-indexing', title: 'Test', blocks: [] });
    });

    it('should never dispatch obsolete un-prefixed or old non-taxonomy routes', () => {
      integratedService.getPublishedCategories().subscribe();
      httpTesting.expectNone('/api/articles/categories');
      httpTesting.expectNone('/api/v1/articles/categories');
      httpTesting.expectNone('/api/v1/articles/public/categories');
      const req = httpTesting.expectOne('/api/v1/articles/public/taxonomy/categories');
      req.flush([]);
    });
  });
});
