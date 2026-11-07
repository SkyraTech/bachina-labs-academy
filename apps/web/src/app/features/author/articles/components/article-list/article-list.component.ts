import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PageHeaderComponent } from '../../../../../shared/ui/page-header/page-header.component';
import {
  StatusBadgeComponent,
  StatusVariant,
} from '../../../../../shared/ui/status-badge/status-badge.component';
import { EmptyStateComponent } from '../../../../../shared/ui/feedback/empty-state.component';
import { LoadingSkeletonComponent } from '../../../../../shared/ui/loading/loading-skeleton.component';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { EditableArticle } from '../../models/article.models';
import { AcademyDialogService, ToastService } from '../../../../../shared/ui';

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
  private readonly dialog = inject(AcademyDialogService);
  private readonly router = inject(Router);

  readonly articles = signal<EditableArticle[]>([]);
  readonly loading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);
  readonly duplicatingId = signal<string | null>(null);

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

  async onDuplicate(article: EditableArticle): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Duplicate Article',
      message: `Create an independent draft copy of "${article.title}"? All content blocks and taxonomy tags will be cloned.`,
      confirmLabel: 'Duplicate Article',
      cancelLabel: 'Cancel',
    });

    if (!confirmed) return;

    this.duplicatingId.set(article.id);
    try {
      const duplicated = await firstValueFrom(this.api.duplicateArticle(article.id));
      this.toast.success('Article duplicated successfully.');
      await this.router.navigate(['/author/articles', duplicated.id, 'edit']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to duplicate article.';
      this.toast.error(msg);
    } finally {
      this.duplicatingId.set(null);
    }
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
