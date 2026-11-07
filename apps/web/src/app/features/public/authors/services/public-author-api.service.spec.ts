import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClientService } from '../../../../core/api';
import { PublicAuthorProfile } from '../models/public-author.models';
import { PublicAuthorApiService } from './public-author-api.service';

describe('PublicAuthorApiService', () => {
  let service: PublicAuthorApiService;
  let apiSpy: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    apiSpy = {
      get: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        PublicAuthorApiService,
        { provide: ApiClientService, useValue: apiSpy },
      ],
    });

    service = TestBed.inject(PublicAuthorApiService);
  });

  it('retrieves author profile with sanitized authorId', () => {
    const mockProfile = {
      id: 'author-123',
      displayName: 'Academy Author',
      publishedArticlesCount: 5,
      joinedAt: '2026-01-01T00:00:00.000Z',
    };
    apiSpy.get.mockReturnValue(of(mockProfile));

    let result: PublicAuthorProfile | undefined;
    service.getAuthorProfile(' author-123 ').subscribe((data) => {
      result = data;
    });

    expect(apiSpy.get).toHaveBeenCalledWith('authors/author-123');
    expect(result).toEqual(mockProfile);
  });

  it('lists author published articles with query params', () => {
    const mockResponse = {
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    };
    apiSpy.get.mockReturnValue(of(mockResponse));

    service
      .getAuthorArticles('author-123', {
        page: 2,
        limit: 10,
        category: 'backend',
        tag: 'postgres',
        q: 'performance',
      })
      .subscribe();

    expect(apiSpy.get).toHaveBeenCalledWith('authors/author-123/articles', {
      params: {
        page: 2,
        limit: 10,
        category: 'backend',
        tag: 'postgres',
        q: 'performance',
      },
    });
  });
});
