import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  OnDestroy,
  signal,
  computed,
  DestroyRef,
  InjectionToken,
} from '@angular/core';
import { CommonModule, DatePipe, DOCUMENT } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PublicArticleApiService } from '../../services/public-article-api.service';
import {
  PublicArticleDetailResponse,
  TypographyPreset,
  computeHeadingAnchors,
} from '../../models/public-article.models';
import { PublicArticleBlockComponent } from '../public-article-block/public-article-block.component';
import { ReaderTableOfContentsComponent } from '../reader-table-of-contents/reader-table-of-contents.component';
import { ArticleShareActionsComponent } from '../article-share-actions/article-share-actions.component';
import { ArticleCommentsComponent } from '../article-comments/article-comments.component';

/**
 * Injection token for the approved public site origin (e.g. 'https://bachinalabs.academy').
 * Defaults to null (no unverified production domain is fabricated).
 */
export const PUBLIC_SITE_ORIGIN = new InjectionToken<string | null>(
  'PUBLIC_SITE_ORIGIN',
  {
    providedIn: 'root',
    factory: () => null,
  },
);

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
 * Manages snapshot-derived document titles, meta descriptions, canonical links, Open Graph,
 * Twitter/X cards, and accessible article sharing with router race protection.
 */
@Component({
  selector: 'app-public-article-reader',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DatePipe,
    PublicArticleBlockComponent,
    ReaderTableOfContentsComponent,
    ArticleShareActionsComponent,
    ArticleCommentsComponent,
  ],
  templateUrl: './public-article-reader.component.html',
  styleUrl: './public-article-reader.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicArticleReaderComponent implements OnInit, OnDestroy {
  private readonly api = inject(PublicArticleApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly publicOrigin = inject(PUBLIC_SITE_ORIGIN, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  private requestId = 0;
  private shareStatusTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly initialDescription: string | null = null;

  readonly article = signal<PublicArticleDetailResponse | null>(null);
  readonly loading = signal<boolean>(true);
  readonly notFound = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly slug = signal<string>('');

  // Sharing signals
  readonly shareStatus = signal<string | null>(null);
  readonly showManualCopy = signal<boolean>(false);

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

  readonly activeHeadingId = signal<string | null>(null);
  private observer: IntersectionObserver | null = null;
  private historyListener: (() => void) | null = null;

  private readonly headingData = computed(() => {
    return computeHeadingAnchors(this.article()?.blocks);
  });

  readonly tableOfContents = computed<TocItem[]>(() => {
    return this.headingData().items.map((h) => ({
      id: h.anchorId,
      text: h.text,
      level: h.level,
    }));
  });

  readonly blockAnchorMap = computed<ReadonlyMap<string, string>>(() => {
    return this.headingData().blockMap;
  });

  constructor() {
    const existing = this.meta.getTag("name='description'");
    this.initialDescription = existing ? existing.content : null;
  }

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      this.historyListener = () => {
        const hash = window.location.hash;
        if (hash) {
          this.scrollToFragmentTarget(hash, true);
        } else {
          this.activeHeadingId.set(null);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      };
      window.addEventListener('popstate', this.historyListener);
      window.addEventListener('hashchange', this.historyListener);
    }

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const slug = params.get('slug')?.trim();
        if (slug) {
          this.slug.set(slug);
          this.loadArticle(slug);
        } else {
          this.notFound.set(true);
          this.loading.set(false);
          this.clearArticleMetadata('not-found');
        }
      });
  }

  ngOnDestroy(): void {
    this.cleanupObserver();
    if (this.historyListener && typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.historyListener);
      window.removeEventListener('hashchange', this.historyListener);
      this.historyListener = null;
    }
    if (this.shareStatusTimeout) {
      clearTimeout(this.shareStatusTimeout);
      this.shareStatusTimeout = null;
    }
    this.clearArticleMetadata('destroy');
  }

  private parseFragmentId(hash: string): string {
    if (!hash) return '';
    const clean = hash.startsWith('#') ? hash.slice(1) : hash;
    try {
      return decodeURIComponent(clean);
    } catch {
      return clean;
    }
  }

  private scrollToFragmentTarget(fragmentId: string, smooth = true): void {
    if (typeof window === 'undefined' || !fragmentId) return;
    const decodedId = this.parseFragmentId(fragmentId);
    if (!decodedId) return;

    const targetEl = this.document.getElementById(decodedId);
    if (targetEl) {
      const prefersReduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      targetEl.scrollIntoView({
        behavior: !smooth || prefersReduced ? 'auto' : 'smooth',
        block: 'start',
      });
      this.activeHeadingId.set(decodedId);
    }
  }

  private setupObserver(): void {
    if (typeof window === 'undefined') return;
    this.cleanupObserver();

    setTimeout(() => {
      // Direct fragment navigation on load or refresh
      if (typeof window !== 'undefined' && window.location.hash) {
        this.scrollToFragmentTarget(window.location.hash, false);
      }

      const toc = this.tableOfContents();
      if (toc.length < 2 || !('IntersectionObserver' in window)) return;

      this.observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((e) => e.isIntersecting);
          if (visible.length > 0) {
            visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
            this.activeHeadingId.set(visible[0].target.id);
          }
        },
        {
          rootMargin: '-80px 0px -60% 0px',
          threshold: [0, 1.0],
        },
      );

      for (const item of toc) {
        const el = this.document.getElementById(item.id);
        if (el) {
          this.observer.observe(el);
        }
      }
    }, 0);
  }

  private cleanupObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  loadArticle(slug: string = this.slug()): void {
    const currentReqId = ++this.requestId;
    this.cleanupObserver();
    this.article.set(null);
    this.loading.set(true);
    this.notFound.set(false);
    this.error.set(null);
    this.shareStatus.set(null);
    this.showManualCopy.set(false);
    this.clearArticleMetadata('loading');

    this.api
      .getPublishedArticleBySlug(slug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (currentReqId !== this.requestId) return;
          this.article.set(res);
          this.updateMetadata(res);
          this.loading.set(false);
          this.setupObserver();
        },
        error: (err: { status?: number }) => {
          if (currentReqId !== this.requestId) return;
          if (err?.status === 404 || err?.status === 400) {
            this.notFound.set(true);
            this.clearArticleMetadata('not-found');
          } else {
            this.error.set(
              'Unable to load this article. Please check your connection and try again.',
            );
            this.clearArticleMetadata('error');
          }
          this.loading.set(false);
        },
      });
  }

  // --- SEO & Head Metadata Lifecycle Management ---

  private updateMetadata(article: PublicArticleDetailResponse): void {
    // 1. Document Title
    this.titleService.setTitle(`${article.title} | Bachina Labs Academy`);

    // 2. Meta Description
    const description = this.sanitizeDescription(article.summary);
    this.meta.updateTag({ name: 'description', content: description });

    // 3. Open Graph
    this.meta.updateTag({ property: 'og:type', content: 'article' }, "property='og:type'");
    this.meta.updateTag(
      { property: 'og:site_name', content: 'Bachina Labs Academy' },
      "property='og:site_name'",
    );
    this.meta.updateTag({ property: 'og:title', content: article.title }, "property='og:title'");
    this.meta.updateTag(
      { property: 'og:description', content: description },
      "property='og:description'",
    );

    // 4. Canonical Link & Open Graph URL (only with verified approved origin)
    const validOrigin = this.sanitizeOrigin(this.publicOrigin);
    if (validOrigin) {
      const canonicalUrl = `${validOrigin}/articles/${encodeURIComponent(article.slug)}`;
      this.meta.updateTag({ property: 'og:url', content: canonicalUrl }, "property='og:url'");
      this.updateCanonicalLink(canonicalUrl);
    } else {
      this.meta.removeTag("property='og:url'");
      this.removeCanonicalLink();
    }

    // 5. Cover Media Image (only if safe public absolute URL exists)
    const safeCoverUrl = this.getSafePublicImageUrl(article.cover?.url);
    if (safeCoverUrl) {
      this.meta.updateTag({ property: 'og:image', content: safeCoverUrl }, "property='og:image'");
      this.meta.updateTag(
        { name: 'twitter:card', content: 'summary_large_image' },
        "name='twitter:card'",
      );
      this.meta.updateTag({ name: 'twitter:image', content: safeCoverUrl }, "name='twitter:image'");
    } else {
      this.meta.removeTag("property='og:image'");
      this.meta.updateTag({ name: 'twitter:card', content: 'summary' }, "name='twitter:card'");
      this.meta.removeTag("name='twitter:image'");
    }

    // 6. Twitter / X Cards
    this.meta.updateTag({ name: 'twitter:title', content: article.title }, "name='twitter:title'");
    this.meta.updateTag(
      { name: 'twitter:description', content: description },
      "name='twitter:description'",
    );
  }

  private clearArticleMetadata(state: 'loading' | 'not-found' | 'error' | 'destroy'): void {
    switch (state) {
      case 'loading':
        this.titleService.setTitle('Loading Article | Bachina Labs Academy');
        break;
      case 'not-found':
        this.titleService.setTitle('Article Not Found | Bachina Labs Academy');
        break;
      case 'error':
        this.titleService.setTitle('Error Loading Article | Bachina Labs Academy');
        break;
      case 'destroy':
        // Do not touch Title on destroy: router destination TitleStrategy handles destination page titles
        break;
    }

    if (state === 'destroy') {
      // If a description existed prior to this reader, restore it; otherwise remove reader-owned description tag
      if (this.initialDescription !== null) {
        this.meta.updateTag({ name: 'description', content: this.initialDescription });
      } else {
        this.meta.removeTag("name='description'");
      }
    } else {
      // In-flight / error / loading state within reader: use neutral fallback
      this.meta.updateTag({
        name: 'description',
        content: 'Read technical articles and engineering insights on Bachina Labs Academy.',
      });
    }

    // Remove article-specific Open Graph and Twitter tags
    this.meta.removeTag("property='og:type'");
    this.meta.removeTag("property='og:site_name'");
    this.meta.removeTag("property='og:title'");
    this.meta.removeTag("property='og:description'");
    this.meta.removeTag("property='og:url'");
    this.meta.removeTag("property='og:image'");
    this.meta.removeTag("name='twitter:card'");
    this.meta.removeTag("name='twitter:title'");
    this.meta.removeTag("name='twitter:description'");
    this.meta.removeTag("name='twitter:image'");

    // Remove canonical link
    this.removeCanonicalLink();
  }

  private sanitizeOrigin(rawOrigin: string | null | undefined): string | null {
    if (!rawOrigin || typeof rawOrigin !== 'string') return null;
    const trimmed = rawOrigin.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
      }
      if (parsed.username || parsed.password) {
        return null;
      }
      if (parsed.search || parsed.hash) {
        return null;
      }
      if (parsed.pathname && parsed.pathname !== '/') {
        return null;
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '0.0.0.0' ||
        host.endsWith('.local') ||
        host.endsWith('.internal')
      ) {
        return null;
      }
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return null;
    }
  }

  private getSafePublicImageUrl(rawUrl: string | null | undefined): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) {
      return null;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
      }
      if (parsed.username || parsed.password) {
        return null;
      }
      const hostname = parsed.hostname.toLowerCase();
      // Reject loopback, local, and private hosts
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '0.0.0.0' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')
      ) {
        return null;
      }
      if (
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
      ) {
        return null;
      }
      return parsed.href;
    } catch {
      return null;
    }
  }

  private sanitizeDescription(summary: string | null | undefined, maxLen = 160): string {
    const fallback = 'Read technical articles and engineering insights on Bachina Labs Academy.';
    if (!summary || !summary.trim()) {
      return fallback;
    }
    const clean = summary.trim().replace(/\s+/g, ' ');
    if (clean.length <= maxLen) {
      return clean;
    }
    // Truncate at maximum length - 3 for ellipsis, while preserving surrogate pairs
    let truncated = clean.slice(0, maxLen - 3);
    // If we sliced inside a high surrogate, remove it to avoid broken encoding
    if (/[\uD800-\uDBFF]$/.test(truncated)) {
      truncated = truncated.slice(0, -1);
    }
    const lastSpace = truncated.lastIndexOf(' ');
    const finalStr = lastSpace > 100 ? truncated.slice(0, lastSpace) : truncated;
    return `${finalStr}...`;
  }

  private updateCanonicalLink(url: string): void {
    if (!this.document || !this.document.head) return;
    let link = this.document.head.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private removeCanonicalLink(): void {
    if (!this.document || !this.document.head) return;
    const link = this.document.head.querySelector("link[rel='canonical']");
    if (link) {
      link.remove();
    }
  }

  // --- Article Sharing Logic ---

  hasNativeShare(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function'
    );
  }

  resolvedShareUrl(sectionAnchor?: string): string | null {
    const art = this.article();
    if (!art || !art.slug) {
      return null;
    }
    const slug = encodeURIComponent(art.slug);

    let base: string | null = null;
    // 1. First preference: verified approved canonical origin
    if (this.publicOrigin) {
      const sanitized = this.sanitizeOrigin(this.publicOrigin);
      if (sanitized) {
        base = `${sanitized}/articles/${slug}`;
      }
    }

    // 2. Fallback: verified current browser location origin
    if (!base && typeof this.document !== 'undefined' && this.document.location) {
      const loc = this.document.location;
      const rawOrigin = loc.origin;
      if (rawOrigin && (rawOrigin.startsWith('https://') || rawOrigin.startsWith('http://'))) {
        try {
          const parsed = new URL(`${rawOrigin}/articles/${slug}`);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            base = `${parsed.protocol}//${parsed.host}/articles/${slug}`;
          }
        } catch {
          // ignore invalid
        }
      }
    }

    if (!base) return null;
    if (sectionAnchor && sectionAnchor.trim()) {
      return `${base}#${encodeURIComponent(sectionAnchor.trim())}`;
    }
    return base;
  }

  async copyArticleLink(sectionAnchor?: string): Promise<void> {
    const art = this.article();
    if (!art) return;

    const url = this.resolvedShareUrl(sectionAnchor);
    if (!url) {
      this.setShareFeedback('Unable to copy link: share URL unavailable');
      return;
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(url);
        this.setShareFeedback(sectionAnchor ? 'Section link copied' : 'Link copied');
        this.showManualCopy.set(false);
        return;
      } catch {
        // Clipboard access rejected or unavailable; fallback to manual input
      }
    }
    this.showManualCopy.set(true);
    this.setShareFeedback('Unable to copy link automatically');
  }

  async copySectionLink(): Promise<void> {
    const headingId = this.activeHeadingId();
    if (!headingId) return;
    await this.copyArticleLink(headingId);
  }

  async shareArticle(): Promise<void> {
    const art = this.article();
    if (!art || !this.hasNativeShare()) return;

    const url = this.resolvedShareUrl();
    if (!url) {
      this.setShareFeedback('Unable to share article: share URL unavailable');
      return;
    }

    try {
      await navigator.share({
        title: art.title,
        text: art.summary ?? undefined,
        url,
      });
    } catch (err: unknown) {
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        (typeof err === 'object' &&
          err !== null &&
          (err as { name?: string }).name === 'AbortError');
      if (isAbort) {
        // User cancelled native share: benign, do not display error or success
        return;
      }
      this.setShareFeedback('Unable to share article');
    }
  }

  private setShareFeedback(message: string): void {
    if (this.shareStatusTimeout) {
      clearTimeout(this.shareStatusTimeout);
    }
    this.shareStatus.set(message);
    this.shareStatusTimeout = setTimeout(() => {
      this.shareStatus.set(null);
    }, 4000);
  }
}
