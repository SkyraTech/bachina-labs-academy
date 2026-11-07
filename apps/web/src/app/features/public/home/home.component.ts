import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  signal,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PublicArticleApiService } from '../articles/services/public-article-api.service';
import {
  PublicArticleItem,
  PublicDiscoveredTaxonomyItem,
  PublicArticleListResponse,
} from '../articles/models/public-article.models';
import { PublicArticleCardComponent } from '../articles/components/public-article-card/public-article-card.component';

/**
 * HomeComponent — Public homepage and content discovery hub for Bachina Labs Academy.
 *
 * Adheres strictly to the four-file standard with external template and styles.
 * Consumes published immutable snapshots only via PublicArticleApiService.
 * Implements authoritative Recent Articles, Category discovery, Tag discovery,
 * and Hero technical topic search without fabricated statistics or fake featured cards.
 * Provides resilient partial-failure tolerance across independent API endpoints.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    PublicArticleCardComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  private readonly api = inject(PublicArticleApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Discovery Content State
  readonly recentArticles = signal<readonly PublicArticleItem[]>([]);
  readonly categories = signal<readonly PublicDiscoveredTaxonomyItem[]>([]);
  readonly tags = signal<readonly PublicDiscoveredTaxonomyItem[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  // Search Input State
  readonly searchQuery = signal<string>('');

  ngOnInit(): void {
    this.loadHomepageData();
  }

  loadHomepageData(): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      articlesRes: this.api
        .listPublishedArticles({ page: 1, limit: 6 })
        .pipe(
          catchError(() => {
            this.error.set('Unable to load recent articles. Please try again.');
            return of(null as PublicArticleListResponse | null);
          }),
        ),
      categoriesRes: this.api
        .getPublishedCategories()
        .pipe(catchError(() => of([] as readonly PublicDiscoveredTaxonomyItem[]))),
      tagsRes: this.api
        .getPublishedTags()
        .pipe(catchError(() => of([] as readonly PublicDiscoveredTaxonomyItem[]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ articlesRes, categoriesRes, tagsRes }) => {
          if (articlesRes) {
            this.recentArticles.set(articlesRes.items || []);
            this.error.set(null);
          } else {
            this.recentArticles.set([]);
            // error signal was set in catchError
          }
          this.categories.set(categoriesRes || []);
          this.tags.set(tagsRes || []);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Unable to load homepage content. Please try again.');
          this.loading.set(false);
        },
      });
  }

  onSearchSubmit(event?: Event): void {
    if (event) {
      event.preventDefault();
    }
    const q = this.searchQuery().trim();
    if (q) {
      this.router.navigate(['/articles'], { queryParams: { q } });
    } else {
      this.router.navigate(['/articles']);
    }
  }

  onClearSearch(): void {
    this.searchQuery.set('');
  }

  onSelectCategory(categorySlug: string): void {
    if (!categorySlug) return;
    this.router.navigate(['/articles'], {
      queryParams: { category: categorySlug.trim() },
    });
  }

  onSelectTag(tagSlug: string): void {
    if (!tagSlug) return;
    this.router.navigate(['/articles'], {
      queryParams: { tag: tagSlug.trim() },
    });
  }
}
