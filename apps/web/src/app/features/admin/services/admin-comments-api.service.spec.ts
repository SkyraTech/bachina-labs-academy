import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminCommentsApiService } from './admin-comments-api.service';
import { ApiClientService } from '../../../core/api/api-client.service';
import type {
  AdminCommentResponse,
  PaginatedAdminCommentsResponse,
} from '../models/admin-comment.model';

describe('AdminCommentsApiService', () => {
  let service: AdminCommentsApiService;
  let mockApiClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };

  const sampleAdminComment: AdminCommentResponse = {
    id: 'c-1',
    articleId: 'art-1',
    articleSlug: 'test-slug',
    articleTitle: 'Test Article',
    authorId: 'u-1',
    authorDisplayName: 'Jane Doe',
    body: 'Comment body',
    status: 'VISIBLE',
    removalReason: null,
    removedAt: null,
    removedByUserId: null,
    retentionRedacted: false,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  };

  const samplePaginated: PaginatedAdminCommentsResponse = {
    items: [sampleAdminComment],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };

  beforeEach(() => {
    mockApiClient = {
      get: vi.fn(),
      post: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AdminCommentsApiService,
        { provide: ApiClientService, useValue: mockApiClient },
      ],
    });

    service = TestBed.inject(AdminCommentsApiService);
  });

  it('lists comments with pagination and filter params', () => {
    mockApiClient.get.mockReturnValue(of(samplePaginated));

    let res: PaginatedAdminCommentsResponse | undefined;
    service.listComments(1, 20, 'REMOVED').subscribe((data) => {
      res = data;
    });

    expect(mockApiClient.get).toHaveBeenCalledWith(
      '/admin/comments?page=1&limit=20&status=REMOVED',
    );
    expect(res).toEqual(samplePaginated);
  });

  it('removes comment via POST /admin/comments/:commentId/remove', () => {
    const removedComment: AdminCommentResponse = {
      ...sampleAdminComment,
      status: 'REMOVED',
      removalReason: 'SPAM',
      removedAt: '2026-11-06T01:00:00.000Z',
      removedByUserId: 'admin-1',
    };
    mockApiClient.post.mockReturnValue(of(removedComment));

    let res: AdminCommentResponse | undefined;
    service.removeComment('c-1', { reason: 'SPAM' }).subscribe((data) => {
      res = data;
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/admin/comments/c-1/remove', {
      reason: 'SPAM',
    });
    expect(res).toEqual(removedComment);
  });
});

