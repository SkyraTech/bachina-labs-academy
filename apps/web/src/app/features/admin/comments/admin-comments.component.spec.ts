import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminCommentsComponent } from './admin-comments.component';
import { AdminCommentsApiService } from '../services/admin-comments-api.service';
import type {
  AdminCommentResponse,
  PaginatedAdminCommentsResponse,
} from '../models/admin-comment.model';

describe('AdminCommentsComponent', () => {
  let component: AdminCommentsComponent;
  let fixture: ComponentFixture<AdminCommentsComponent>;
  let mockAdminApi: {
    listComments: ReturnType<typeof vi.fn>;
    removeComment: ReturnType<typeof vi.fn>;
  };

  const sampleComment: AdminCommentResponse = {
    id: 'c-1',
    articleId: 'art-1',
    articleSlug: 'concurrency-in-postgresql',
    articleTitle: 'Concurrency in PostgreSQL',
    authorId: 'u-1',
    authorDisplayName: 'Jane Doe',
    body: 'Spam comment to remove',
    status: 'VISIBLE',
    removalReason: null,
    removedAt: null,
    removedByUserId: null,
    retentionRedacted: false,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  };

  const samplePaginated: PaginatedAdminCommentsResponse = {
    items: [sampleComment],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };

  beforeEach(async () => {
    mockAdminApi = {
      listComments: vi.fn().mockReturnValue(of(samplePaginated)),
      removeComment: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AdminCommentsComponent],
      providers: [
        { provide: AdminCommentsApiService, useValue: mockAdminApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminCommentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads comments on init', () => {
    expect(mockAdminApi.listComments).toHaveBeenCalledWith(1, 20, undefined);
    expect(component.comments().length).toBe(1);
    expect(component.loading()).toBe(false);
  });

  it('filters comments by status', () => {
    component.setFilter('REMOVED');
    expect(component.statusFilter()).toBe('REMOVED');
    expect(mockAdminApi.listComments).toHaveBeenCalledWith(1, 20, 'REMOVED');
  });

  it('opens and cancels remove dialog', () => {
    component.openRemoveDialog(sampleComment);
    expect(component.moderatingCommentId()).toBe('c-1');
    expect(component.selectedReason()).toBe('SPAM');

    component.cancelRemove();
    expect(component.moderatingCommentId()).toBeNull();
  });

  it('confirms soft removal and updates comment state in list', () => {
    const updated: AdminCommentResponse = {
      ...sampleComment,
      status: 'REMOVED',
      removalReason: 'HARASSMENT',
      removedAt: '2026-11-06T01:00:00.000Z',
      removedByUserId: 'admin-1',
    };
    mockAdminApi.removeComment.mockReturnValue(of(updated));

    component.openRemoveDialog(sampleComment);
    component.selectedReason.set('HARASSMENT');
    component.confirmRemove();

    expect(mockAdminApi.removeComment).toHaveBeenCalledWith('c-1', {
      reason: 'HARASSMENT',
    });
    expect(component.comments()[0].status).toBe('REMOVED');
    expect(component.moderatingCommentId()).toBeNull();
    expect(component.successMessage()).toBe(
      'Comment successfully removed from public visibility.',
    );
  });

  it('handles removal error gracefully', () => {
    mockAdminApi.removeComment.mockReturnValue(
      throwError(() => ({ error: { message: 'Removal forbidden.' } })),
    );

    component.openRemoveDialog(sampleComment);
    component.confirmRemove();

    expect(component.errorMessage()).toBe('Removal forbidden.');
    expect(component.removing()).toBe(false);
  });
});

