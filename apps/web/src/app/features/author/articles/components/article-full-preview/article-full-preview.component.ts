import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  OnDestroy,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { CommonModule, DatePipe, DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { EditableArticle, ArticleBlock, TypographyPreset } from '../../models/article.models';
import {
  PublicArticleBlock,
  PublicMedia,
  HeadingAnchorMapping,
  computeHeadingAnchors,
} from '../../../../public/articles/models/public-article.models';
import { TocItem } from '../../../../public/articles/components/public-article-reader/public-article-reader.component';
import { PublicArticleBlockComponent } from '../../../../public/articles/components/public-article-block/public-article-block.component';
import { ReaderTableOfContentsComponent } from '../../../../public/articles/components/reader-table-of-contents/reader-table-of-contents.component';

/**
 * Maps a private draft ArticleBlock to the PublicArticleBlock structure accepted by PublicArticleBlockComponent.
 * Resolves private media URLs using ArticleMediaApiService under the active author session.
 * Respects real MIME metadata without hardcoded assumptions.
 */
export function mapDraftBlockToPublicBlock(
  block: ArticleBlock,
  mediaApi: ArticleMediaApiService,
): PublicArticleBlock {
  const mediaUrl = block.mediaAssetId ? mediaApi.getPrivateMediaPreviewUrl(block.mediaAssetId) : null;
  const mediaAlt = (block.content['altText'] as string) || (block.content['caption'] as string) || null;
  const rawMime =
    (block.content['mimeType'] as string) || (block.content['contentType'] as string) || '';
  const mediaMime = rawMime || 'application/octet-stream';

  const media: PublicMedia | null = block.mediaAssetId
    ? {
        id: block.mediaAssetId,
        mimeType: mediaMime,
        width: typeof block.content['width'] === 'number' ? (block.content['width'] as number) : null,
        height: typeof block.content['height'] === 'number' ? (block.content['height'] as number) : null,
        altText: mediaAlt,
        url: mediaUrl,
      }
    : null;

  return {
    id: block.id,
    type: block.type,
    position: block.position,
    schemaVersion: block.schemaVersion,
    content: block.content,
    media,
  };
}

@Component({
  selector: 'app-article-full-preview',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DatePipe,
    PublicArticleBlockComponent,
    ReaderTableOfContentsComponent,
  ],
  templateUrl: './article-full-preview.component.html',
  styleUrl: './article-full-preview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleFullPreviewComponent implements OnInit, OnDestroy {
  private readonly api = inject(ArticleEditorApiService);
  private readonly mediaApi = inject(ArticleMediaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly article = signal<EditableArticle | null>(null);
  readonly loading = signal<boolean>(true);
  readonly notFound = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly articleId = signal<string>('');

  readonly activeHeadingId = signal<string | null>(null);
  private historyListener: (() => void) | null = null;

  readonly mappedBlocks = computed<PublicArticleBlock[]>(() => {
    const art = this.article();
    if (!art || !art.blocks) return [];
    const sorted = [...art.blocks].sort((a, b) => a.position - b.position);
    return sorted.map((b) => mapDraftBlockToPublicBlock(b, this.mediaApi));
  });

  readonly headingData = computed(() => {
    return computeHeadingAnchors(this.mappedBlocks());
  });

  readonly tableOfContents = computed<TocItem[]>(() => {
    return this.headingData().items.map((h: HeadingAnchorMapping) => ({
      id: h.anchorId,
      text: h.text,
      level: h.level,
    }));
  });

  readonly blockAnchorMap = computed<ReadonlyMap<string, string>>(() => {
    return this.headingData().blockMap;
  });

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

  ngOnInit(): void {
    // Add noindex, nofollow to prevent search-engine indexing of private draft preview
    this.meta.addTag({ name: 'robots', content: 'noindex, nofollow' });

    if (typeof window !== 'undefined') {
      this.historyListener = () => {
        const hash = window.location.hash;
        if (hash) {
          const clean = hash.startsWith('#') ? hash.slice(1) : hash;
          try {
            const targetId = decodeURIComponent(clean);
            this.activeHeadingId.set(targetId);
            const targetEl = this.document.getElementById(targetId);
            if (targetEl) {
              targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          } catch {
            void 0;
          }
        }
      };
      window.addEventListener('popstate', this.historyListener);
      window.addEventListener('hashchange', this.historyListener);
    }

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('articleId')?.trim();
      if (id) {
        this.articleId.set(id);
        this.loadDraft(id);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.historyListener && typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.historyListener);
      window.removeEventListener('hashchange', this.historyListener);
      this.historyListener = null;
    }
    this.meta.removeTag("name='robots'");
  }

  loadDraft(id?: string): void {
    const targetId = id || this.articleId();
    if (!targetId) {
      this.notFound.set(true);
      this.loading.set(false);
      return;
    }

    this.articleId.set(targetId);
    this.loading.set(true);
    this.error.set(null);
    this.notFound.set(false);

    this.api
      .getArticle(targetId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.article.set(data);
          this.titleService.setTitle(`${data.title} (Draft Preview) · Bachina Labs Academy`);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          if (err?.status === 404) {
            this.notFound.set(true);
          } else if (err?.status === 401) {
            this.router.navigate(['/login'], {
              queryParams: { returnUrl: `/author/articles/${targetId}/preview` },
            });
          } else {
            const msg =
              err?.error?.message ||
              err?.message ||
              'Unable to load article draft preview. Please verify your connection.';
            this.error.set(msg);
          }
        },
      });
  }

  getCoverUrl(mediaId: string): string {
    return this.mediaApi.getPrivateMediaPreviewUrl(mediaId);
  }

  backToEditor(): void {
    const id = this.articleId();
    if (id) {
      this.router.navigate(['/author/articles', id, 'edit']);
    } else {
      this.router.navigate(['/author/articles']);
    }
  }
}
