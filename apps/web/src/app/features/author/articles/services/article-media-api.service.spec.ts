import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService } from '../../../../core/api';
import { ArticleMediaApiService } from './article-media-api.service';
import { MediaAssetDto, PaginatedMediaAssetsResponse } from '../models/article-media.models';

describe('ArticleMediaApiService', () => {
  let service: ArticleMediaApiService;
  let apiClientMock: {
    post: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    resolveUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    apiClientMock = {
      post: vi.fn(),
      get: vi.fn(),
      resolveUrl: vi.fn((path: string) => `/api/v1/${path}`),
    };

    TestBed.configureTestingModule({
      providers: [
        ArticleMediaApiService,
        { provide: ApiClientService, useValue: apiClientMock },
      ],
    });

    service = TestBed.inject(ArticleMediaApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('uploadMedia', () => {
    it('should post FormData to articles/media', () => {
      const mockResponse: MediaAssetDto = {
        id: 'media-123',
        originalFilename: 'test.png',
        mimeType: 'image/png',
        fileSize: 1024,
        mediaType: 'IMAGE',
        width: null,
        height: null,
        createdAt: '2026-10-26T00:00:00Z',
      };

      apiClientMock.post.mockReturnValue(of(mockResponse));

      const file = new File(['mock content'], 'test.png', { type: 'image/png' });
      let result: MediaAssetDto | undefined;

      service.uploadMedia(file).subscribe((res) => {
        result = res;
      });

      expect(apiClientMock.post).toHaveBeenCalledTimes(1);
      const [path, formData] = apiClientMock.post.mock.calls[0];
      expect(path).toBe('articles/media');
      expect(formData).toBeInstanceOf(FormData);
      expect((formData as FormData).get('file')).toBe(file);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('listMyMedia', () => {
    it('should get paginated assets from articles/media/mine', () => {
      const mockResponse: PaginatedMediaAssetsResponse = {
        items: [],
        total: 0,
        page: 1,
        limit: 12,
        totalPages: 0,
      };

      apiClientMock.get.mockReturnValue(of(mockResponse));

      let result: PaginatedMediaAssetsResponse | undefined;
      service.listMyMedia({ page: 2, limit: 10 }).subscribe((res) => {
        result = res;
      });

      expect(apiClientMock.get).toHaveBeenCalledWith('articles/media/mine', {
        params: { page: 2, limit: 10 },
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getPrivateMediaPreviewUrl', () => {
    it('should construct private media preview content URL using resolveUrl', () => {
      const url = service.getPrivateMediaPreviewUrl('media-uuid-456');
      expect(apiClientMock.resolveUrl).toHaveBeenCalledWith('articles/media/media-uuid-456/content');
      expect(url).toBe('/api/v1/articles/media/media-uuid-456/content');
    });
  });
});
