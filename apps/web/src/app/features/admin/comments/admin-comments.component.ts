import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { AdminCommentsApiService } from '../services/admin-comments-api.service';
import type {
  AdminCommentResponse,
  CommentStatus,
  ModerationReason,
} from '../models/admin-comment.model';

@Component({
  selector: 'app-admin-comments',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-comments.component.html',
  styleUrl: './admin-comments.component.css',
})
export class AdminCommentsComponent implements OnInit {
  private readonly adminCommentsApi = inject(AdminCommentsApiService);

  readonly comments = signal<AdminCommentResponse[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly statusFilter = signal<CommentStatus | undefined>(undefined);
  readonly currentPage = signal(1);
  readonly totalPages = signal(1);
  readonly totalCount = signal(0);

  // Moderation action modal state
  readonly moderatingCommentId = signal<string | null>(null);
  readonly selectedReason = signal<ModerationReason>('SPAM');
  readonly removing = signal(false);

  readonly moderationReasons: { value: ModerationReason; label: string }[] = [
    { value: 'SPAM', label: 'Spam or unsolicited advertising' },
    { value: 'HARASSMENT', label: 'Harassment or personal attack' },
    { value: 'HATE_SPEECH', label: 'Hate speech or discrimination' },
    { value: 'INAPPROPRIATE', label: 'Inappropriate or offensive language' },
    { value: 'OFF_TOPIC', label: 'Off-topic or irrelevant discussion' },
    { value: 'POLICY_VIOLATION', label: 'Platform terms & policy violation' },
  ];

  ngOnInit(): void {
    this.fetchComments(1);
  }

  fetchComments(page = 1): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.adminCommentsApi
      .listComments(page, 20, this.statusFilter())
      .subscribe({
        next: (res) => {
          this.comments.set(res.items);
          this.currentPage.set(res.meta.page);
          this.totalPages.set(res.meta.totalPages);
          this.totalCount.set(res.meta.total);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(err?.error?.message ?? 'Failed to load comments directory.');
          this.loading.set(false);
        },
      });
  }

  setFilter(status: CommentStatus | undefined): void {
    this.statusFilter.set(status);
    this.fetchComments(1);
  }

  openRemoveDialog(comment: AdminCommentResponse): void {
    this.moderatingCommentId.set(comment.id);
    this.selectedReason.set('SPAM');
    this.errorMessage.set(null);
  }

  cancelRemove(): void {
    this.moderatingCommentId.set(null);
  }

  confirmRemove(): void {
    const commentId = this.moderatingCommentId();
    if (!commentId) return;

    this.removing.set(true);
    this.errorMessage.set(null);

    this.adminCommentsApi
      .removeComment(commentId, { reason: this.selectedReason() })
      .subscribe({
        next: (updated) => {
          this.comments.update((list) =>
            list.map((c) => (c.id === commentId ? updated : c)),
          );
          this.moderatingCommentId.set(null);
          this.removing.set(false);
          this.successMessage.set('Comment successfully removed from public visibility.');
        },
        error: (err) => {
          this.errorMessage.set(err?.error?.message ?? 'Failed to remove comment.');
          this.removing.set(false);
        },
      });
  }

  dismissMessages(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }
}

