import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * LoadingSkeletonComponent — Accessible animated placeholder for async content.
 */
@Component({
  selector: 'app-loading-skeleton',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './loading-skeleton.component.css',
  template: `
    <div
      class="animate-pulse bg-[var(--color-surface-hover)] border border-[var(--color-border)]"
      [ngClass]="shapeClasses()"
      [style.width]="width()"
      [style.height]="height()"
      role="status"
      aria-label="Loading content"
    >
      <span class="sr-only">Loading...</span>
    </div>
  `,
})
export class LoadingSkeletonComponent {
  readonly width = input<string>('100%');
  readonly height = input<string>('1rem');
  readonly shape = input<'rectangle' | 'circle' | 'pill'>('rectangle');

  protected shapeClasses(): string {
    switch (this.shape()) {
      case 'circle':
        return 'rounded-full aspect-square';
      case 'pill':
        return 'rounded-full';
      case 'rectangle':
      default:
        return 'rounded-md';
    }
  }
}
