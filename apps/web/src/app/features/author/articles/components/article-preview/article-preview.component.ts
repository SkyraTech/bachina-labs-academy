import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleMediaApiService } from '../../services/article-media-api.service';

@Component({
  selector: 'app-article-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './article-preview.component.html',
  styleUrl: './article-preview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticlePreviewComponent {
  readonly state = inject(ArticleEditorStateService);
  private readonly mediaApi = inject(ArticleMediaApiService);

  getTypographyFontClass(): string {
    const preset = this.state.article()?.typographyPreset;
    switch (preset) {
      case 'EDITORIAL_SERIF':
        return 'font-serif';
      case 'TECHNICAL_MINIMAL':
        return 'font-mono';
      case 'MODERN_SANS':
      default:
        return 'font-sans';
    }
  }

  getPrivateMediaUrl(mediaId: string): string {
    return this.mediaApi.getPrivateMediaPreviewUrl(mediaId);
  }

  asHtml(content: Record<string, unknown>): string {
    return typeof content['html'] === 'string' ? content['html'] : '';
  }

  asStringArray(val: unknown): string[] {
    return Array.isArray(val) ? (val as string[]) : [];
  }

  asStringMatrix(val: unknown): string[][] {
    return Array.isArray(val) ? (val as string[][]) : [];
  }

  getCalloutClasses(variant: unknown): string {
    switch (variant) {
      case 'WARNING':
        return 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300';
      case 'TIP':
        return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300';
      case 'NOTE':
        return 'bg-neutral-500/10 border-neutral-500/30 text-neutral-800 dark:text-neutral-300';
      case 'INFO':
      default:
        return 'bg-sky-500/10 border-sky-500/30 text-sky-800 dark:text-sky-300';
    }
  }
}
