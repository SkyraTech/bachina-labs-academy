import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PageHeaderComponent } from '../../../../../shared/ui/page-header/page-header.component';
import {
  StatusBadgeComponent,
  StatusVariant,
} from '../../../../../shared/ui/status-badge/status-badge.component';
import { EmptyStateComponent } from '../../../../../shared/ui/feedback/empty-state.component';
import { LoadingSkeletonComponent } from '../../../../../shared/ui/loading/loading-skeleton.component';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { TaxonomyApiService } from '../../../../../core/taxonomy/services/taxonomy-api.service';
import { Category } from '../../../../../core/taxonomy/models/taxonomy.models';
import { EditableArticle } from '../../models/article.models';
import { AcademyDialogService, ToastService } from '../../../../../shared/ui';

export type ArticleFilterTab = 'ALL' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

@Component({
  selector: 'app-article-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
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
export class ArticleListComponent implements OnInit, OnDestroy {
  private readonly api = inject(ArticleEditorApiService);
  private readonly taxonomyApi = inject(TaxonomyApiService, { optional: true });
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(AcademyDialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });

  readonly articles = signal<EditableArticle[]>([]);
  readonly loading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);
  readonly duplicatingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);
  readonly archivingId = signal<string | null>(null);
  readonly restoringId = signal<string | null>(null);

  // Filter & Pagination signals
  readonly activeTab = signal<ArticleFilterTab>('ALL');
  readonly searchInput = signal<string>('');
  readonly searchQuery = signal<string>('');
  readonly selectedCategoryId = signal<string | null>(null);
  readonly categories = signal<Category[]>([]);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(20);
  readonly totalArticles = signal<number>(0);
  readonly totalPages = signal<number>(0);
  readonly pageSizeOptions = [10, 20, 50];

  private searchDebounceTimer?: ReturnType<typeof setTimeout>;

  readonly tabCounts = computed(() => {
    const list = this.articles();
    let draftCount = 0;
    let publishedCount = 0;
    let archivedCount = 0;

    for (const a of list) {
      if (a.status === 'DRAFT') draftCount++;
      else if (a.status === 'PUBLISHED') publishedCount++;
      else if (a.status === 'ARCHIVED') archivedCount++;
    }

    return {
      all: this.activeTab() === 'ALL' && this.totalArticles() > 0 ? this.totalArticles() : list.length,
      draft: this.activeTab() === 'DRAFT' && this.totalArticles() > 0 ? this.totalArticles() : draftCount,
      published: this.activeTab() === 'PUBLISHED' && this.totalArticles() > 0 ? this.totalArticles() : publishedCount,
      archived: this.activeTab() === 'ARCHIVED' && this.totalArticles() > 0 ? this.totalArticles() : archivedCount,
    };
  });

  readonly filteredArticles = computed(() => {
    const tab = this.activeTab();
    const list = this.articles();
    if (tab === 'ALL') return list;
    return list.filter((a) => a.status === tab);
  });

  readonly showingStart = computed(() => {
    if (this.totalArticles() === 0) return 0;
    return (this.currentPage() - 1) * this.pageSize() + 1;
  });

  readonly showingEnd = computed(() => {
    return Math.min(this.currentPage() * this.pageSize(), this.totalArticles());
  });

  readonly pageNumbers = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    if (total <= 1) return [1];

    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, current - 2);
    let end = Math.min(total, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  });

  ngOnInit(): void {
    this.parseInitialParams();
    this.loadCategories();
    this.loadArticles();
  }

  ngOnDestroy(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
  }

  private parseInitialParams(): void {
    if (!this.route) return;
    const params = this.route.snapshot.queryParamMap;

    const tabParam = (params.get('tab') || params.get('status'))?.toUpperCase();
    if (tabParam === 'DRAFT' || tabParam === 'PUBLISHED' || tabParam === 'ARCHIVED') {
      this.activeTab.set(tabParam);
    }

    const searchParam = params.get('search');
    if (searchParam) {
      this.searchInput.set(searchParam);
      this.searchQuery.set(searchParam);
    }

    const categoryParam = params.get('categoryId') || params.get('category');
    if (categoryParam) {
      this.selectedCategoryId.set(categoryParam);
    }

    const pageParam = params.get('page');
    if (pageParam) {
      const p = parseInt(pageParam, 10);
      if (!isNaN(p) && p >= 1) {
        this.currentPage.set(p);
      }
    }

    const limitParam = params.get('limit') || params.get('pageSize');
    if (limitParam) {
      const l = parseInt(limitParam, 10);
      if ([10, 20, 50].includes(l)) {
        this.pageSize.set(l);
      }
    }
  }

  loadCategories(): void {
    if (!this.taxonomyApi) return;
    this.taxonomyApi.getCategories(1, 100).subscribe({
      next: (res) => {
        this.categories.set(res.items || []);
      },
      error: () => {},
    });
  }

  setTab(tab: ArticleFilterTab): void {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    this.currentPage.set(1);
    this.loadArticles();
    this.updateQueryParams();
  }

  onSearchInput(value: string): void {
    this.searchInput.set(value);
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.searchQuery.set(value.trim());
      this.currentPage.set(1);
      this.loadArticles();
      this.updateQueryParams();
    }, 300);
  }

  clearSearch(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchInput.set('');
    this.searchQuery.set('');
    this.currentPage.set(1);
    this.loadArticles();
    this.updateQueryParams();
  }

  onCategoryChange(categoryId: string | null): void {
    this.selectedCategoryId.set(categoryId || null);
    this.currentPage.set(1);
    this.loadArticles();
    this.updateQueryParams();
  }

  onPageSizeChange(size: number): void {
    if (this.pageSize() === size) return;
    this.pageSize.set(size);
    this.currentPage.set(1);
    this.loadArticles();
    this.updateQueryParams();
  }

  goToPage(page: number): void {
    if (page < 1 || (this.totalPages() > 0 && page > this.totalPages()) || page === this.currentPage()) {
      return;
    }
    this.currentPage.set(page);
    this.loadArticles();
    this.updateQueryParams();
  }

  prevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  private updateQueryParams(): void {
    const queryParams: Record<string, string | number | null> = {};
    queryParams['tab'] = this.activeTab() !== 'ALL' ? this.activeTab() : null;
    queryParams['search'] = this.searchQuery() ? this.searchQuery() : null;
    queryParams['categoryId'] = this.selectedCategoryId() ? this.selectedCategoryId() : null;
    queryParams['page'] = this.currentPage() > 1 ? this.currentPage() : null;
    queryParams['limit'] = this.pageSize() !== 20 ? this.pageSize() : null;

    this.router.navigate([], {
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  isActionInProgress(articleId: string): boolean {
    return (
      this.duplicatingId() === articleId ||
      this.deletingId() === articleId ||
      this.archivingId() === articleId ||
      this.restoringId() === articleId
    );
  }

  loadArticles(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    const params: {
      page: number;
      limit: number;
      status?: ArticleFilterTab;
      search?: string;
      categoryId?: string;
    } = {
      page: this.currentPage(),
      limit: this.pageSize(),
    };

    if (this.activeTab() !== 'ALL') {
      params.status = this.activeTab();
    }
    if (this.searchQuery()) {
      params.search = this.searchQuery();
    }
    if (this.selectedCategoryId()) {
      params.categoryId = this.selectedCategoryId()!;
    }

    this.api.listMyArticles(params).subscribe({
      next: (res) => {
        this.articles.set(res.items);
        this.totalArticles.set(res.total);
        this.totalPages.set(res.totalPages);
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
    if (this.isActionInProgress(article.id)) return;

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

  isDeletable(article: EditableArticle): boolean {
    return (
      article.status === 'DRAFT' &&
      !article.currentSnapshotId &&
      !article.publishedSlug &&
      (!article.publishedRevision || article.publishedRevision === 0)
    );
  }

  async onDelete(article: EditableArticle): Promise<void> {
    if (this.isActionInProgress(article.id)) return;

    const confirmed = await this.dialog.confirm({
      title: 'Delete Draft Article',
      message: `Are you sure you want to permanently delete "${article.title}"? This action cannot be undone.`,
      confirmLabel: 'Delete Draft',
      cancelLabel: 'Cancel',
      type: 'danger',
      destructive: true,
      closable: true,
      dismissableMask: true,
    });

    if (!confirmed) return;

    this.deletingId.set(article.id);
    try {
      await firstValueFrom(this.api.deleteArticle(article.id, article.draftRevision));
      this.toast.success('Draft article deleted successfully.');
      this.articles.update((list) => list.filter((a) => a.id !== article.id));
      this.totalArticles.update((t) => Math.max(0, t - 1));
      if (this.articles().length === 0 && this.currentPage() > 1) {
        this.currentPage.update((p) => p - 1);
        this.loadArticles();
      }
    } catch (err: unknown) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ||
        (err instanceof Error ? err.message : 'Failed to delete draft article.');
      this.toast.error(msg);
      this.loadArticles();
    } finally {
      this.deletingId.set(null);
    }
  }

  async onArchive(article: EditableArticle): Promise<void> {
    if (this.isActionInProgress(article.id)) return;

    const confirmed = await this.dialog.confirm({
      title: 'Archive Article?',
      message: `Archive this Article? It will immediately disappear from Academy public listings, and its public URL will return 404. Its published slug and publication history will be preserved, so you can restore it later. ("${article.title}")`,
      confirmLabel: 'Archive Article',
      cancelLabel: 'Cancel',
      type: 'confirm',
      closable: true,
      dismissableMask: true,
    });

    if (!confirmed) return;

    this.archivingId.set(article.id);
    try {
      await firstValueFrom(this.api.archiveArticle(article.id, article.draftRevision));
      this.toast.success(`Article "${article.title}" archived successfully.`);
      this.loadArticles();
    } catch (err: unknown) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ||
        (err instanceof Error ? err.message : 'Failed to archive article.');
      this.toast.error(msg);
      this.loadArticles();
    } finally {
      this.archivingId.set(null);
    }
  }

  async onRestore(article: EditableArticle): Promise<void> {
    if (this.isActionInProgress(article.id)) return;

    const confirmed = await this.dialog.confirm({
      title: 'Restore Article?',
      message: `Restore "${article.title}" to public visibility? The public reader will immediately resume serving the previous published snapshot. Any newer draft edits will remain private until published.`,
      confirmLabel: 'Restore Article',
      cancelLabel: 'Cancel',
      type: 'info',
      closable: true,
      dismissableMask: true,
    });

    if (!confirmed) return;

    this.restoringId.set(article.id);
    try {
      await firstValueFrom(this.api.restoreArticle(article.id, article.draftRevision));
      this.toast.success(`Article "${article.title}" restored to published status.`);
      this.loadArticles();
    } catch (err: unknown) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ||
        (err instanceof Error ? err.message : 'Failed to restore article.');
      this.toast.error(msg);
      this.loadArticles();
    } finally {
      this.restoringId.set(null);
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
