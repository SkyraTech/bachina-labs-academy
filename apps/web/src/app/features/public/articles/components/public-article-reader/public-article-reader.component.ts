import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PublicArticleApiService } from '../../services/public-article-api.service';
import {
  PublicArticleDetailResponse,
  TypographyPreset,
} from '../../models/public-article.models';
import { PublicArticleBlockComponent } from '../public-article-block/public-article-block.component';

export interface TocItem {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

/**
 * PublicArticleReaderComponent — Long-form reading interface for published articles.
 *
 * Adheres strictly to the four-file standard with external template and styles.
 * Consumes immutable publication snapshots only; isolates published content from draft state.
 * Gracefully handles 404 Not Found for missing or historical slugs without synthetic redirects.
 */
@Component({
  selector: 'app-public-article-reader',
  standalone: true,
  imports: [CommonModule, RouterLink, DatePipe, PublicArticleBlockComponent],
  templateUrl: './public-article-reader.component.html',
  styleUrl: './public-article-reader.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicArticleReaderComponent implements OnInit {
  private readonly api = inject(PublicArticleApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly titleService = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  readonly article = signal<PublicArticleDetailResponse | null>(null);
  readonly loading = signal<boolean>(true);
  readonly notFound = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly slug = signal<string>('');

  readonly typographyFontClass = computed(() => {
    const preset = this.article()?.typographyPreset as TypographyPreset;
    switch (preset) {
      case 'EDITORIAL_SERIF':
        return 'font-serif';
      case 'TECHNICAL_MINIMAL':
        return 'font-mono';
      case 'MODERN_SANS':
      default:
        return 'font-sans';
    }
  });

  readonly tableOfContents = computed<TocItem[]>(() => {
    const art = this.article();
    if (!art?.blocks) return [];

    const toc: TocItem[] = [];
    for (const b of art.blocks) {
      if (b.type === 'HEADING' && typeof b.content['text'] === 'string') {
        const text = b.content['text'];
        const level = typeof b.content['level'] === 'number' ? b.content['level'] : 2;
        if (level <= 3) {
          const id = text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
          toc.push({ id, text, level });
        }
      }
    }
    return toc;
  });

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const slug = params.get('slug');
        if (slug) {
          this.slug.set(slug);
          this.loadArticle(slug);
        } else {
          this.notFound.set(true);
          this.loading.set(false);
        }
      });
  }

  loadArticle(slug: string = this.slug()): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.error.set(null);

    this.api.getPublishedArticleBySlug(slug).subscribe({
      next: (res) => {
        this.article.set(res);
        this.titleService.setTitle(`${res.title} · Bachina Labs Academy`);
        this.loading.set(false);
      },
      error: (err: { status?: number }) => {
        if (err?.status === 404 || err?.status === 400) {
          this.notFound.set(true);
        } else {
          this.error.set('Unable to load this article. Please check your connection and try again.');
        }
        this.loading.set(false);
      },
    });
  }
}
