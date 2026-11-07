import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
  inject,
  OnDestroy,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';

@Component({
  selector: 'app-article-share-actions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './article-share-actions.component.html',
  styleUrls: ['./article-share-actions.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleShareActionsComponent implements OnDestroy {
  private readonly document = inject(DOCUMENT);

  // Inputs
  readonly slug = input.required<string>();
  readonly title = input.required<string>();
  readonly summary = input<string | null>(null);
  readonly activeHeadingId = input<string | null>(null);
  readonly publicOrigin = input<string | null>(null);

  // State signals
  readonly shareStatus = signal<string | null>(null);
  readonly showManualCopy = signal<boolean>(false);
  readonly manualCopyUrl = signal<string>('');
  readonly isNativeShareSupported = signal<boolean>(this.checkNativeShare());

  private shareStatusTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.shareStatusTimeout) {
      clearTimeout(this.shareStatusTimeout);
      this.shareStatusTimeout = null;
    }
  }

  hasNativeShare(): boolean {
    const isLive = (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function'
    );
    this.isNativeShareSupported();
    return isLive;
  }

  refreshNativeShareCapability(): boolean {
    const available = this.checkNativeShare();
    this.isNativeShareSupported.set(available);
    return available;
  }

  private checkNativeShare(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function'
    );
  }

  resolveUrl(sectionId?: string | null): string | null {
    const rawSlug = this.slug();
    if (!rawSlug || !rawSlug.trim()) {
      return null;
    }
    const encodedSlug = encodeURIComponent(rawSlug.trim());

    let baseOrigin: string | null = null;

    // 1. Preference: verified configured publicOrigin
    const originInput = this.publicOrigin();
    if (originInput) {
      const sanitized = this.sanitizeOrigin(originInput);
      if (sanitized) {
        baseOrigin = sanitized;
      }
    }

    // 2. Fallback: verified current window location origin
    if (!baseOrigin && typeof this.document !== 'undefined' && this.document.location) {
      const loc = this.document.location;
      const raw = loc.origin;
      if (raw && (raw.startsWith('https://') || raw.startsWith('http://'))) {
        try {
          const parsed = new URL(`${raw}/articles/${encodedSlug}`);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            baseOrigin = `${parsed.protocol}//${parsed.host}`;
          }
        } catch {
          // ignore invalid origin
        }
      }
    }

    if (!baseOrigin) {
      return null;
    }

    let url = `${baseOrigin}/articles/${encodedSlug}`;
    if (sectionId && sectionId.trim()) {
      url += `#${encodeURIComponent(sectionId.trim())}`;
    }

    return url;
  }

  async copyLink(sectionId?: string | null): Promise<void> {
    const url = this.resolveUrl(sectionId);
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
        this.setShareFeedback(sectionId ? 'Section link copied' : 'Link copied');
        this.showManualCopy.set(false);
        return;
      } catch {
        // Clipboard rejected or denied; fallback to manual input box
      }
    }

    this.manualCopyUrl.set(url);
    this.showManualCopy.set(true);
    this.setShareFeedback('Unable to copy link automatically');
  }

  async copySectionLink(): Promise<void> {
    const headingId = this.activeHeadingId();
    if (headingId) {
      await this.copyLink(headingId);
    }
  }

  async shareNative(): Promise<void> {
    if (!this.hasNativeShare()) {
      return;
    }

    const url = this.resolveUrl();
    if (!url) {
      this.setShareFeedback('Unable to share article: share URL unavailable');
      return;
    }

    try {
      await navigator.share({
        title: this.title(),
        text: this.summary() ?? undefined,
        url,
      });
    } catch (err: unknown) {
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        (typeof err === 'object' &&
          err !== null &&
          (err as { name?: string }).name === 'AbortError');
      if (isAbort) {
        // Benign cancellation: do not show false error or success
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

  private sanitizeOrigin(origin: string): string | null {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null;
      }
      return `${url.protocol}//${url.host}`;
    } catch {
      return null;
    }
  }
}

