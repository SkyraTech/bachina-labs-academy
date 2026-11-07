import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  inject,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { TocItem } from '../public-article-reader/public-article-reader.component';

/**
 * ReaderTableOfContentsComponent — Interactive Table of Contents for technical articles.
 *
 * Responsibilities:
 * - Desktop: Sticky side navigation ("On this page") preserving reading width.
 * - Mobile/Tablet: Accessible collapsible disclosure widget.
 * - Active section tracking with visual indicator and aria-current="location".
 * - Smooth scroll navigation respecting prefers-reduced-motion.
 * - Disambiguated anchor ID targets.
 */
@Component({
  selector: 'app-reader-table-of-contents',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reader-table-of-contents.component.html',
  styleUrl: './reader-table-of-contents.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReaderTableOfContentsComponent {
  private readonly document = inject(DOCUMENT);

  readonly tocItems = input.required<readonly TocItem[]>();
  readonly activeId = input<string | null>(null);
  readonly mode = input<'mobile' | 'desktop' | 'all'>('all');

  readonly navigateTo = output<string>();

  readonly mobileOpen = signal<boolean>(false);

  toggleMobile(): void {
    this.mobileOpen.update((open) => !open);
  }

  scrollToSection(event: Event, id: string): void {
    event.preventDefault();

    const targetEl = this.document.getElementById(id);
    if (targetEl) {
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      targetEl.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });

      if (typeof window !== 'undefined' && window.history?.pushState) {
        window.history.pushState(null, '', `${window.location.pathname}#${id}`);
      }

      this.navigateTo.emit(id);
      this.mobileOpen.set(false);
    }
  }
}
