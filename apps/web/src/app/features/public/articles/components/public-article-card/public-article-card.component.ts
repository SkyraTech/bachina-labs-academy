import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PublicArticleItem } from '../../models/public-article.models';

/**
 * PublicArticleCardComponent — Renders a card preview of a published article.
 *
 * Adheres strictly to the four-file standard with external template and styles.
 * Consumes immutable snapshot projections only; handles null media URLs gracefully.
 */
@Component({
  selector: 'app-public-article-card',
  standalone: true,
  imports: [CommonModule, RouterLink, DatePipe],
  templateUrl: './public-article-card.component.html',
  styleUrl: './public-article-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicArticleCardComponent {
  readonly article = input.required<PublicArticleItem>();

  getTypographyBadgeLabel(preset: string | undefined): string {
    switch (preset) {
      case 'EDITORIAL_SERIF':
        return 'Editorial Serif';
      case 'TECHNICAL_MINIMAL':
        return 'Technical Minimal';
      case 'MODERN_SANS':
      default:
        return 'Modern Sans';
    }
  }
}
