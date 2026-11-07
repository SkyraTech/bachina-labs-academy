import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LoadingSkeletonComponent } from '../../../shared/ui/loading/loading-skeleton.component';
import { EmptyStateComponent } from '../../../shared/ui/feedback/empty-state.component';
import { AdminApiService } from '../services/admin-api.service';
import { AdminArticleItem, PaginatedAdminArticlesResponse } from '../models/admin.models';

/**
 * AdminArticlesComponent — Administrative article oversight directory.
 *
 * Enforces:
 * - Read-only inspection across all lifecycle statuses (DRAFT, PUBLISHED, ARCHIVED)
 * - Distinction between draft mutable metadata and frozen published snapshots
 * - Safe navigation to public reader for published articles
 * - Server-side pagination, status filtering, and title/slug search
 * - URL query parameter synchronization
 */
@Component({
  selector: 'app-admin-articles',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    PageHeaderComponent,
    LoadingSkeletonComponent,
    EmptyStateComponent,
  ],
  templateUrl: './admin-articles.component.html',
  styleUrl: './admin-articles.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminArticlesComponent implements OnInit {
  private readonly adminApi = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly articles = signal<readonly AdminArticleItem[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(20);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  // Filter state
  readonly statusFilter = signal<string>('ALL');
  readonly searchQuery = signal<string>('');

  // Selected article for modal inspection
  readonly selectedArticle = signal<AdminArticleItem | null>(null);

  readonly hasActiveFilters = computed(() => {
    return this.statusFilter() !== 'ALL' || this.searchQuery().trim() !== '';
  });

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.selectedArticle()) {
      this.closeModal();
    }
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const pageParam = Number(params.get('page')) || 1;
      const limitParam = Number(params.get('limit')) || 20;
      const statusParam = params.get('status') || 'ALL';
      const qParam = params.get('q') || '';

      this.page.set(pageParam);
      this.limit.set(limitParam);
      this.statusFilter.set(statusParam);
      this.searchQuery.set(qParam);

      this.fetchArticles();
    });
  }

  fetchArticles(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.adminApi
      .listArticles({
        page: this.page(),
        limit: this.limit(),
        status: this.statusFilter() !== 'ALL' ? this.statusFilter() : undefined,
        q: this.searchQuery().trim() || undefined,
      })
      .subscribe({
        next: (res: PaginatedAdminArticlesResponse) => {
          this.articles.set(res.data);
          this.total.set(res.total);
          this.page.set(res.page);
          this.limit.set(res.limit);
          this.totalPages.set(res.totalPages || 1);
          this.loading.set(false);
        },
        error: () => {
          this.errorMessage.set('Failed to load article oversight directory. Please try again.');
          this.loading.set(false);
        },
      });
  }

  onFilterChange(): void {
    this.updateQueryParams({ page: 1 });
  }

  onSearchSubmit(): void {
    this.updateQueryParams({ page: 1 });
  }

  clearFilters(): void {
    this.statusFilter.set('ALL');
    this.searchQuery.set('');
    this.updateQueryParams({ page: 1, status: 'ALL', q: '' });
  }

  goToPage(newPage: number): void {
    if (newPage < 1 || newPage > this.totalPages()) return;
    this.updateQueryParams({ page: newPage });
  }

  viewArticle(article: AdminArticleItem): void {
    this.selectedArticle.set(article);
  }

  closeModal(): void {
    this.selectedArticle.set(null);
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeModal();
    }
  }

  private updateQueryParams(extra: Record<string, string | number | undefined>): void {
    const qParams: Record<string, string | number | null> = {
      page: extra['page'] ?? this.page(),
      limit: this.limit() !== 20 ? this.limit() : null,
      status: (extra['status'] ?? this.statusFilter()) !== 'ALL' ? (extra['status'] ?? this.statusFilter()) : null,
      q: (extra['q'] ?? this.searchQuery().trim()) || null,
    };

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: qParams,
      queryParamsHandling: 'merge',
    });
  }
}
