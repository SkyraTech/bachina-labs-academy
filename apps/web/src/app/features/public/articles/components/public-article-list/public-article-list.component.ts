import { Component, ChangeDetectionStrategy, inject, OnInit, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PublicArticleApiService } from '../../services/public-article-api.service';
import { PublicArticleItem } from '../../models/public-article.models';
import { PublicArticleCardComponent } from '../public-article-card/public-article-card.component';
import { PublicArticlePaginationComponent } from '../public-article-pagination/public-article-pagination.component';

/**
 * PublicArticleListComponent — Public article catalog and discovery page.
 *
 * Adheres strictly to the four-file standard with external template and styles.
 * Consumes public API endpoint GET /api/v1/articles/public with backend-driven pagination.
 */
@Component({
  selector: 'app-public-article-list',
  standalone: true,
  imports: [
    CommonModule,
    PublicArticleCardComponent,
    PublicArticlePaginationComponent,
  ],
  templateUrl: './public-article-list.component.html',
  styleUrl: './public-article-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicArticleListComponent implements OnInit {
  private readonly api = inject(PublicArticleApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly articles = signal<PublicArticleItem[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  readonly page = signal<number>(1);
  readonly limit = signal<number>(20);
  readonly total = signal<number>(0);
  readonly totalPages = signal<number>(0);

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const pageParam = Number(params.get('page'));
        const targetPage = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
        this.page.set(targetPage);
        this.loadArticles(targetPage);
      });
  }

  loadArticles(targetPage: number = this.page()): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.listPublishedArticles({ page: targetPage, limit: this.limit() }).subscribe({
      next: (res) => {
        this.articles.set([...res.items]);
        this.page.set(res.page);
        this.limit.set(res.limit);
        this.total.set(res.total);
        this.totalPages.set(res.totalPages);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Unable to load articles. Please check your network connection and try again.');
        this.loading.set(false);
      },
    });
  }

  onPageChange(newPage: number): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: newPage },
      queryParamsHandling: 'merge',
    });
  }
}
