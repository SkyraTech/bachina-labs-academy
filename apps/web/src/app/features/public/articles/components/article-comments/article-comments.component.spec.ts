import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticleCommentsComponent } from './article-comments.component';
import { ArticleCommentsApiService } from '../../services/article-comments-api.service';
import { AuthStateService } from '../../../../../core/auth/services/auth-state.service';
import type { CurrentUser } from '../../../../../core/auth/models';
import type {
  PaginatedPublicCommentsResponse,
  PublicCommentResponse,
} from '../../models/article-comment.model';

describe('ArticleCommentsComponent', () => {
  let component: ArticleCommentsComponent;
  let fixture: ComponentFixture<ArticleCommentsComponent>;
  let mockCommentsApi: {
    getPublicComments: ReturnType<typeof vi.fn>;
    createComment: ReturnType<typeof vi.fn>;
    updateComment: ReturnType<typeof vi.fn>;
    deleteComment: ReturnType<typeof vi.fn>;
  };
  let mockAuthState: {
    currentUser: ReturnType<typeof vi.fn>;
    isAuthenticated: ReturnType<typeof vi.fn>;
  };

  const sampleComment: PublicCommentResponse = {
    id: 'c-1',
    articleSlug: 'test-article',
    snapshotRevision: 1,
    authorDisplayName: 'Jane Doe',
    isArticleAuthor: true,
    body: 'Snapshot-consistent comment body',
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  };

  const samplePaginated: PaginatedPublicCommentsResponse = {
    items: [sampleComment],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };

  const mockUser: CurrentUser = {
    id: 'u-1',
    email: 'user@example.com',
    role: 'AUTHOR',
    status: 'ACTIVE',
    emailVerifiedAt: '2026-11-06T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockCommentsApi = {
      getPublicComments: vi.fn().mockReturnValue(of(samplePaginated)),
      createComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
    };

    mockAuthState = {
      currentUser: vi.fn().mockReturnValue(mockUser),
      isAuthenticated: vi.fn().mockReturnValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleCommentsComponent],
      providers: [
        provideRouter([]),
        { provide: ArticleCommentsApiService, useValue: mockCommentsApi },
        { provide: AuthStateService, useValue: mockAuthState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleCommentsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('articleSlug', 'test-article');
    fixture.detectChanges();
  });

  it('loads comments on init', () => {
    expect(mockCommentsApi.getPublicComments).toHaveBeenCalledWith('test-article', 1, 20);
    expect(component.comments().length).toBe(1);
    expect(component.totalCount()).toBe(1);
    expect(component.loading()).toBe(false);
  });

  it('submits a new comment and prepends it to the list', () => {
    const newComment: PublicCommentResponse = {
      id: 'c-2',
      articleSlug: 'test-article',
      snapshotRevision: 1,
      authorDisplayName: 'Jane Doe',
      isArticleAuthor: true,
      body: 'Second comment',
      createdAt: '2026-11-06T01:00:00.000Z',
      updatedAt: '2026-11-06T01:00:00.000Z',
    };
    mockCommentsApi.createComment.mockReturnValue(of(newComment));

    component.newCommentText.set('Second comment');
    component.submitComment();

    expect(mockCommentsApi.createComment).toHaveBeenCalledWith('test-article', {
      body: 'Second comment',
    });
    expect(component.comments().length).toBe(2);
    expect(component.comments()[0]).toEqual(newComment);
    expect(component.newCommentText()).toBe('');
  });

  it('handles submission error gracefully', () => {
    mockCommentsApi.createComment.mockReturnValue(
      throwError(() => ({ error: { message: 'Submission failed' } })),
    );

    component.newCommentText.set('Error text');
    component.submitComment();

    expect(component.errorMessage()).toBe('Submission failed');
    expect(component.submitting()).toBe(false);
  });

  it('updates an existing comment inline', () => {
    const updated: PublicCommentResponse = {
      ...sampleComment,
      body: 'Updated text content',
    };
    mockCommentsApi.updateComment.mockReturnValue(of(updated));

    component.startEdit(sampleComment);
    expect(component.editingCommentId()).toBe('c-1');
    expect(component.editingText()).toBe('Snapshot-consistent comment body');

    component.editingText.set('Updated text content');
    component.saveEdit('c-1');

    expect(mockCommentsApi.updateComment).toHaveBeenCalledWith('c-1', {
      body: 'Updated text content',
    });
    expect(component.comments()[0].body).toBe('Updated text content');
    expect(component.editingCommentId()).toBeNull();
  });

  it('deletes a comment when confirmed', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockCommentsApi.deleteComment.mockReturnValue(of(undefined));

    component.deleteComment('c-1');

    expect(mockCommentsApi.deleteComment).toHaveBeenCalledWith('c-1');
    expect(component.comments().length).toBe(0);
    expect(component.totalCount()).toBe(0);
  });
});

