import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticleCommentsApiService } from './article-comments-api.service';
import { ApiClientService } from '../../../../core/api/api-client.service';
import type {
  PaginatedPublicCommentsResponse,
  PublicCommentResponse,
} from '../models/article-comment.model';

describe('ArticleCommentsApiService', () => {
  let service: ArticleCommentsApiService;
  let mockApiClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  const sampleComment: PublicCommentResponse = {
    id: 'c-1',
    articleSlug: 'test-article',
    snapshotRevision: 1,
    authorDisplayName: 'Jane Doe',
    isArticleAuthor: false,
    body: 'Great article!',
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  };

  const samplePaginated: PaginatedPublicCommentsResponse = {
    items: [sampleComment],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };

  beforeEach(() => {
    mockApiClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ArticleCommentsApiService,
        { provide: ApiClientService, useValue: mockApiClient },
      ],
    });

    service = TestBed.inject(ArticleCommentsApiService);
  });

  it('fetches comments via GET /articles/public/:slug/comments', () => {
    mockApiClient.get.mockReturnValue(of(samplePaginated));

    let res: PaginatedPublicCommentsResponse | undefined;
    service.getPublicComments('test-article', 1, 20).subscribe((data) => {
      res = data;
    });

    expect(mockApiClient.get).toHaveBeenCalledWith(
      '/articles/public/test-article/comments?page=1&limit=20',
    );
    expect(res).toEqual(samplePaginated);
  });

  it('creates comment via POST /articles/public/:slug/comments', () => {
    mockApiClient.post.mockReturnValue(of(sampleComment));

    let res: PublicCommentResponse | undefined;
    service.createComment('test-article', { body: 'Great article!' }).subscribe((data) => {
      res = data;
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      '/articles/public/test-article/comments',
      { body: 'Great article!' },
    );
    expect(res).toEqual(sampleComment);
  });

  it('updates comment via PATCH /comments/:commentId', () => {
    mockApiClient.patch.mockReturnValue(of(sampleComment));

    let res: PublicCommentResponse | undefined;
    service.updateComment('c-1', { body: 'Updated text' }).subscribe((data) => {
      res = data;
    });

    expect(mockApiClient.patch).toHaveBeenCalledWith('/comments/c-1', {
      body: 'Updated text',
    });
    expect(res).toEqual(sampleComment);
  });

  it('deletes comment via DELETE /comments/:commentId', () => {
    mockApiClient.delete.mockReturnValue(of(undefined));

    service.deleteComment('c-1').subscribe();

    expect(mockApiClient.delete).toHaveBeenCalledWith('/comments/c-1');
  });
});

