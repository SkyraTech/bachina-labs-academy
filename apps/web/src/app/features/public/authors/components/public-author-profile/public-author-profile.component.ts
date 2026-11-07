import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PublicAuthorApiService } from '../../services/public-author-api.service';
import { PublicAuthorProfile } from '../../models/public-author.models';
import { PublicArticleItem } from '../../../articles/models/public-article.models';
import { PublicArticleCardComponent } from '../../../articles/components/public-article-card/public-article-card.component';
import { PublicArticlePaginationComponent } from '../../../articles/components/public-article-pagination/public-article-pagination.component';

/**
 * PublicAuthorProfileComponent — Renders public author identity and published articles.
 *
 * Requirements:
 * - Publicly accessible without authentication.
 * - Displays author public identity (display name, article count, joined date).
 * - Strictly excludes private fields (email, password, sessions, tokens, role).
 * - Queries published articles strictly from immutable snapshots.
 * - Handles 404 cleanly when author does not exist or is inactive.
 */
@Component({
  selector: 'app-public-author-profile',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DatePipe,
    PublicArticleCardComponent,
    PublicArticlePaginationComponent,
  ],
  templateUrl: './public-author-profile.component.html',
  styleUrl: './public-author-profile.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicAuthorProfileComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly authorApi = inject(PublicAuthorApiService);
  private readonly titleService = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  readonly authorId = signal<string>('');
  readonly profile = signal<PublicAuthorProfile | null>(null);
  readonly articles = signal<readonly PublicArticleItem[]>([]);
  readonly loading = signal<boolean>(true);
  readonly articlesLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly page = signal<number>(1);
  readonly limit = signal<number>(12);
  readonly total = signal<number>(0);
  readonly totalPages = signal<number>(0);

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('authorId')?.trim() ?? '';
        if (id) {
          this.authorId.set(id);
          this.page.set(1);
          this.loadAuthorProfile(id);
          this.loadAuthorArticles(id, 1);
        } else {
          this.error.set('Author not found.');
          this.loading.set(false);
        }
      });
  }

  loadAuthorProfile(id: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.authorApi.getAuthorProfile(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (prof) => {
          this.profile.set(prof);
          this.titleService.setTitle(`${prof.displayName} · Bachina Labs Academy`);
          this.loading.set(false);
        },
        error: (err) => {
          if (err.status === 404) {
            this.error.set('Author not found or profile is unavailable.');
          } else {
            this.error.set('Unable to load author profile. Please try again later.');
          }
          this.loading.set(false);
        },
      });
  }

  loadAuthorArticles(id: string, pageNum: number): void {
    this.articlesLoading.set(true);

    this.authorApi
      .getAuthorArticles(id, { page: pageNum, limit: this.limit() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.articles.set(res.items);
          this.page.set(res.page);
          this.total.set(res.total);
          this.totalPages.set(res.totalPages);
          this.articlesLoading.set(false);
        },
        error: () => {
          this.articles.set([]);
          this.articlesLoading.set(false);
        },
      });
  }

  onPageChange(newPage: number): void {
    const id = this.authorId();
    if (id && newPage !== this.page()) {
      this.page.set(newPage);
      this.loadAuthorArticles(id, newPage);
      window.scrollTo({ top: 300, behavior: 'smooth' });
    }
  }
}

