import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ArticleCommentsApiService } from '../../services/article-comments-api.service';
import { AuthStateService } from '../../../../../core/auth/services/auth-state.service';
import type { PublicCommentResponse } from '../../models/article-comment.model';

@Component({
  selector: 'app-article-comments',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './article-comments.component.html',
  styleUrl: './article-comments.component.css',
})
export class ArticleCommentsComponent implements OnInit {
  private readonly commentsApi = inject(ArticleCommentsApiService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);

  readonly articleSlug = input.required<string>();

  readonly comments = signal<PublicCommentResponse[]>([]);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly updatingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);
  readonly newCommentText = signal('');
  readonly editingCommentId = signal<string | null>(null);
  readonly editingText = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly currentPage = signal(1);
  readonly totalPages = signal(1);
  readonly totalCount = signal(0);

  readonly currentUser = computed(() => this.authState.currentUser());
  readonly isAuthenticated = computed(() => this.authState.isAuthenticated());
  readonly isEmailVerified = computed(() => !!this.currentUser()?.emailVerifiedAt);
  readonly canComment = computed(() => this.isAuthenticated() && this.isEmailVerified());

  readonly currentReturnUrl = computed(() => this.router.url);

  ngOnInit(): void {
    this.loadComments(1);
  }

  loadComments(page = 1): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.commentsApi.getPublicComments(this.articleSlug(), page, 20).subscribe({
      next: (res) => {
        this.comments.set(res.items);
        this.currentPage.set(res.meta.page);
        this.totalPages.set(res.meta.totalPages);
        this.totalCount.set(res.meta.total);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message ?? 'Failed to load comments.');
        this.loading.set(false);
      },
    });
  }

  submitComment(): void {
    const text = this.newCommentText().trim();
    if (!text || text.length > 2000) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.commentsApi
      .createComment(this.articleSlug(), { body: text })
      .subscribe({
        next: (created) => {
          this.comments.update((list) => [created, ...list]);
          this.totalCount.update((c) => c + 1);
          this.newCommentText.set('');
          this.submitting.set(false);
          this.successMessage.set('Your comment has been posted.');
        },
        error: (err) => {
          this.errorMessage.set(err?.error?.message ?? 'Failed to submit comment.');
          this.submitting.set(false);
        },
      });
  }

  startEdit(comment: PublicCommentResponse): void {
    this.editingCommentId.set(comment.id);
    this.editingText.set(comment.body);
    this.errorMessage.set(null);
  }

  cancelEdit(): void {
    this.editingCommentId.set(null);
    this.editingText.set('');
  }

  saveEdit(commentId: string): void {
    const text = this.editingText().trim();
    if (!text || text.length > 2000) {
      return;
    }

    this.updatingId.set(commentId);
    this.errorMessage.set(null);

    this.commentsApi.updateComment(commentId, { body: text }).subscribe({
      next: (updated) => {
        this.comments.update((list) =>
          list.map((c) => (c.id === commentId ? { ...c, body: updated.body, updatedAt: updated.updatedAt } : c)),
        );
        this.editingCommentId.set(null);
        this.editingText.set('');
        this.updatingId.set(null);
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message ?? 'Failed to update comment.');
        this.updatingId.set(null);
      },
    });
  }

  deleteComment(commentId: string): void {
    if (!confirm('Are you sure you want to permanently delete this comment?')) {
      return;
    }

    this.deletingId.set(commentId);
    this.errorMessage.set(null);

    this.commentsApi.deleteComment(commentId).subscribe({
      next: () => {
        this.comments.update((list) => list.filter((c) => c.id !== commentId));
        this.totalCount.update((c) => Math.max(0, c - 1));
        this.deletingId.set(null);
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message ?? 'Failed to delete comment.');
        this.deletingId.set(null);
      },
    });
  }

  dismissMessages(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }
}

