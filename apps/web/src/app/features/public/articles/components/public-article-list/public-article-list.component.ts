import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PublicArticleApiService } from '../../services/public-article-api.service';
import {
  PublicArticleItem,
  PublicDiscoveredTaxonomyItem,
} from '../../models/public-article.models';
import { PublicArticleCardComponent } from '../public-article-card/public-article-card.component';
import { PublicArticlePaginationComponent } from '../public-article-pagination/public-article-pagination.component';

/**
 * PublicArticleListComponent — Public article catalog and discovery page.
 *
 * Adheres strictly to the four-file standard with external template and styles.
 * Consumes public API endpoint GET /api/v1/articles/public with backend-driven pagination.
 * Integrates immutable published taxonomy discovery and URL-synchronized filtering.
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

  private readonly SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  private requestId = 0;

  // Article Listing State
  readonly articles = signal<PublicArticleItem[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  readonly page = signal<number>(1);
  readonly limit = signal<number>(20);
  readonly total = signal<number>(0);
  readonly totalPages = signal<number>(0);

  // Taxonomy Discovery State
  readonly categories = signal<readonly PublicDiscoveredTaxonomyItem[]>([]);
  readonly categoriesLoading = signal<boolean>(false);
  readonly categoriesError = signal<string | null>(null);

  readonly tags = signal<readonly PublicDiscoveredTaxonomyItem[]>([]);
  readonly tagsLoading = signal<boolean>(false);
  readonly tagsError = signal<string | null>(null);

  // Active Filter State (URL-synchronized)
  readonly selectedCategory = signal<string | null>(null);
  readonly selectedTag = signal<string | null>(null);
  readonly appliedSearch = signal<string | null>(null);
  readonly searchQuery = signal<string>('');

  readonly hasActiveFilters = computed(
    () =>
      !!this.selectedCategory() ||
      !!this.selectedTag() ||
      !!this.appliedSearch(),
  );

  readonly activeCategoryName = computed(() => {
    const slug = this.selectedCategory();
    if (!slug) return null;
    const found = this.categories().find((c) => c.slug === slug);
    return found ? found.name : slug;
  });

  readonly activeTagName = computed(() => {
    const slug = this.selectedTag();
    if (!slug) return null;
    const found = this.tags().find((t) => t.slug === slug);
    return found ? found.name : slug;
  });

  ngOnInit(): void {
    this.loadCategories();
    this.loadTags();

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const pageValues = params.getAll('page');
        const rawPage = pageValues.length === 1 ? Number(pageValues[0]) : 1;
        const targetPage =
          Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

        const catValues = params.getAll('category');
        const rawCat = catValues.length === 1 ? catValues[0].trim() : null;
        const validCat =
          rawCat && this.SLUG_REGEX.test(rawCat) && rawCat.length <= 160
            ? rawCat
            : null;

        const tagValues = params.getAll('tag');
        const rawTag = tagValues.length === 1 ? tagValues[0].trim() : null;
        const validTag =
          rawTag && this.SLUG_REGEX.test(rawTag) && rawTag.length <= 120
            ? rawTag
            : null;

        const qValues = params.getAll('q');
        const hasQ = params.has('q');
        const rawQ = qValues.length === 1 ? qValues[0].trim() : null;
        const validQ =
          rawQ &&
          rawQ.length <= 120 &&
          !Array.from(rawQ).some((c) => {
            const code = c.charCodeAt(0);
            return (code >= 0 && code <= 31) || code === 127;
          })
            ? rawQ
            : null;

        if (hasQ && !validQ) {
          this.requestId++;
          this.appliedSearch.set(null);
          this.searchQuery.set('');

          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {
              category: validCat ?? null,
              tag: validTag ?? null,
              page: 1,
              q: null,
            },
            replaceUrl: true,
          });
          return;
        }

        this.page.set(targetPage);
        this.selectedCategory.set(validCat);
        this.selectedTag.set(validTag);
        this.appliedSearch.set(validQ);
        this.searchQuery.set(validQ ?? '');

        this.loadArticles(targetPage, validCat, validTag, validQ);
      });
  }

  loadCategories(): void {
    this.categoriesLoading.set(true);
    this.categoriesError.set(null);

    this.api
      .getPublishedCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.categories.set(data);
          this.categoriesLoading.set(false);
        },
        error: () => {
          this.categoriesError.set('Unable to load categories.');
          this.categoriesLoading.set(false);
        },
      });
  }

  loadTags(): void {
    this.tagsLoading.set(true);
    this.tagsError.set(null);

    this.api
      .getPublishedTags()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.tags.set(data);
          this.tagsLoading.set(false);
        },
        error: () => {
          this.tagsError.set('Unable to load tags.');
          this.tagsLoading.set(false);
        },
      });
  }

  loadArticles(
    targetPage: number = this.page(),
    category: string | null = this.selectedCategory(),
    tag: string | null = this.selectedTag(),
    q: string | null = this.appliedSearch(),
  ): void {
    const currentReqId = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);

    this.api
      .listPublishedArticles({
        page: targetPage,
        limit: this.limit(),
        category: category ?? undefined,
        tag: tag ?? undefined,
        q: q ?? undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (currentReqId !== this.requestId) return;
          this.articles.set([...res.items]);
          this.page.set(res.page);
          this.limit.set(res.limit);
          this.total.set(res.total);
          this.totalPages.set(res.totalPages);
          this.loading.set(false);
        },
        error: () => {
          if (currentReqId !== this.requestId) return;
          this.error.set(
            'Unable to load articles. Please check your network connection and try again.',
          );
          this.loading.set(false);
        },
      });
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  onSearchSubmit(event?: Event): void {
    if (event) {
      event.preventDefault();
    }
    const term = this.searchQuery().trim();
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: term || null,
        page: 1,
      },
      queryParamsHandling: 'merge',
    });
  }

  onClearSearch(): void {
    this.searchQuery.set('');
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: null,
        page: 1,
      },
      queryParamsHandling: 'merge',
    });
  }

  onSelectCategory(slug: string): void {
    const nextCat = this.selectedCategory() === slug ? null : slug;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        category: nextCat,
        page: 1,
      },
      queryParamsHandling: 'merge',
    });
  }

  onSelectTag(slug: string): void {
    const nextTag = this.selectedTag() === slug ? null : slug;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tag: nextTag,
        page: 1,
      },
      queryParamsHandling: 'merge',
    });
  }

  onClearCategory(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        category: null,
        page: 1,
      },
      queryParamsHandling: 'merge',
    });
  }

  onClearTag(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tag: null,
        page: 1,
      },
      queryParamsHandling: 'merge',
    });
  }

  onClearAllFilters(): void {
    this.searchQuery.set('');
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        category: null,
        tag: null,
        q: null,
        page: 1,
      },
      queryParamsHandling: 'merge',
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
