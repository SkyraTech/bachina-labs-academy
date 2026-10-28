import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * PublicArticlePaginationComponent — Accessible pagination control for article listings.
 *
 * Adheres strictly to the four-file standard with external template and styles.
 * Sourced authoritatively from backend total and totalPages response attributes.
 */
@Component({
  selector: 'app-public-article-pagination',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-article-pagination.component.html',
  styleUrl: './public-article-pagination.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicArticlePaginationComponent {
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly total = input.required<number>();

  readonly pageChange = output<number>();

  readonly hasPrevious = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.page() < this.totalPages());

  /**
   * Generates a sliding window of visible page numbers.
   */
  readonly visiblePages = computed(() => {
    const current = this.page();
    const total = this.totalPages();
    if (total <= 1) return [];

    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, current - 2);
    const end = Math.min(total, start + maxVisible - 1);

    if (end - start < maxVisible - 1) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  });

  goToPage(targetPage: number): void {
    if (targetPage >= 1 && targetPage <= this.totalPages() && targetPage !== this.page()) {
      this.pageChange.emit(targetPage);
    }
  }

  previous(): void {
    if (this.hasPrevious()) {
      this.pageChange.emit(this.page() - 1);
    }
  }

  next(): void {
    if (this.hasNext()) {
      this.pageChange.emit(this.page() + 1);
    }
  }
}
