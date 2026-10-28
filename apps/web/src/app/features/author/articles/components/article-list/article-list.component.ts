import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../../../../shared/ui/page-header/page-header.component';
import {
  StatusBadgeComponent,
  StatusVariant,
} from '../../../../../shared/ui/status-badge/status-badge.component';
import { EmptyStateComponent } from '../../../../../shared/ui/feedback/empty-state.component';
import { LoadingSkeletonComponent } from '../../../../../shared/ui/loading/loading-skeleton.component';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { EditableArticle } from '../../models/article.models';
import { ToastService } from '../../../../../shared/ui';

@Component({
  selector: 'app-article-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    PageHeaderComponent,
    StatusBadgeComponent,
    EmptyStateComponent,
    LoadingSkeletonComponent,
  ],
  templateUrl: './article-list.component.html',
  styleUrl: './article-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleListComponent implements OnInit {
  private readonly api = inject(ArticleEditorApiService);
  private readonly toast = inject(ToastService);

  readonly articles = signal<EditableArticle[]>([]);
  readonly loading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.loadArticles();
  }

  loadArticles(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api.listMyArticles({ page: 1, limit: 50 }).subscribe({
      next: (res) => {
        this.articles.set(res.items);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to retrieve your articles.';
        this.errorMessage.set(msg);
        this.toast.error(msg);
        this.loading.set(false);
      },
    });
  }

  getStatusVariant(status: string): StatusVariant {
    switch (status) {
      case 'PUBLISHED':
        return 'success';
      case 'DRAFT':
        return 'neutral';
      case 'ARCHIVED':
        return 'error';
      default:
        return 'neutral';
    }
  }
}
