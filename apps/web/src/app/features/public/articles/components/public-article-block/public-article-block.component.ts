import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PublicArticleBlock } from '../../models/public-article.models';

/**
 * PublicArticleBlockComponent — Renders an individual immutable article content block.
 *
 * Implements all ten approved Article Block types:
 * HEADING, RICH_TEXT, IMAGE, VIDEO, CODE, QUOTE, CALLOUT, TABLE, DIVIDER, LINK_CARD.
 *
 * Security:
 * - Employs Angular standard [innerHTML] binding (DOM sanitizer) for RICH_TEXT.
 * - NEVER uses DomSanitizer.bypassSecurityTrustHtml.
 * - Interpolates CODE blocks as literal text within <pre><code> to prevent script execution.
 * - Strictly validates URL protocols (http: and https: only) for external links.
 * - Handles null media URLs gracefully with accessible placeholders without leaking storage keys.
 */
@Component({
  selector: 'app-public-article-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-article-block.component.html',
  styleUrl: './public-article-block.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicArticleBlockComponent {
  readonly block = input.required<PublicArticleBlock>();

  /**
   * Generates a slugified HTML ID for heading blocks to enable anchor links and TOC.
   */
  getHeadingId(text: unknown): string {
    if (typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  asHtml(content: Record<string, unknown>): string {
    return typeof content['html'] === 'string' ? content['html'] : '';
  }

  asLanguage(val: unknown): string {
    return typeof val === 'string' && val.trim().length > 0
      ? val.trim().toUpperCase()
      : 'TEXT';
  }

  asStringArray(val: unknown): string[] {
    return Array.isArray(val) ? (val as string[]) : [];
  }

  asStringMatrix(val: unknown): string[][] {
    return Array.isArray(val) ? (val as string[][]) : [];
  }

  asVideoProvider(provider: unknown): 'YOUTUBE' | 'VIMEO' | 'CUSTOM' {
    if (provider === 'YOUTUBE' || provider === 'VIMEO') {
      return provider;
    }
    return 'CUSTOM';
  }

  getVideoProviderLabel(provider: unknown): string {
    switch (provider) {
      case 'YOUTUBE':
        return 'YouTube';
      case 'VIMEO':
        return 'Vimeo';
      case 'CUSTOM':
      default:
        return 'Custom';
    }
  }

  /**
   * Validates external URL protocols to permit only http: and https:.
   * Blocks javascript:, data:, and relative exploits.
   */
  isSafeUrl(url: unknown): boolean {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  getCalloutVariantClasses(variant: unknown): string {
    switch (variant) {
      case 'WARNING':
        return 'callout-warning bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200';
      case 'TIP':
        return 'callout-tip bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200';
      case 'NOTE':
        return 'callout-note bg-neutral-500/10 border-neutral-500/30 text-neutral-900 dark:text-neutral-200';
      case 'INFO':
      default:
        return 'callout-info bg-sky-500/10 border-sky-500/30 text-sky-900 dark:text-sky-200';
    }
  }

  getCalloutIcon(variant: unknown): string {
    switch (variant) {
      case 'WARNING':
        return '⚠';
      case 'TIP':
        return '💡';
      case 'NOTE':
        return '📌';
      case 'INFO':
      default:
        return 'ℹ';
    }
  }
}
