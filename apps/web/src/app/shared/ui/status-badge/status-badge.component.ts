import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type StatusVariant = 'brand' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
export type StatusSize = 'sm' | 'md';

/**
 * StatusBadgeComponent — Reusable status and taxonomy tag.
 */
@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './status-badge.component.css',
  template: `
    <span
      class="inline-flex items-center gap-1.5 font-medium rounded-full border transition-colors duration-150"
      [ngClass]="[variantClasses(), sizeClasses()]"
    >
      @if (dot()) {
        <span class="w-1.5 h-1.5 rounded-full" [ngClass]="dotClasses()"></span>
      }
      <ng-content></ng-content>
    </span>
  `,
})
export class StatusBadgeComponent {
  readonly variant = input<StatusVariant>('neutral');
  readonly size = input<StatusSize>('sm');
  readonly dot = input<boolean>(false);

  protected variantClasses(): string {
    switch (this.variant()) {
      case 'brand':
        return 'bg-[var(--color-brand-surface)] text-[var(--color-brand-deep)] border-[var(--color-brand-muted)]';
      case 'success':
        return 'bg-[var(--color-success-surface)] text-[var(--color-success)] border-[var(--color-success)]/20';
      case 'warning':
        return 'bg-[var(--color-warning-surface)] text-[var(--color-warning)] border-[var(--color-warning)]/20';
      case 'error':
        return 'bg-[var(--color-error-surface)] text-[var(--color-error)] border-[var(--color-error)]/20';
      case 'info':
        return 'bg-[var(--color-info-surface)] text-[var(--color-info)] border-[var(--color-info)]/20';
      case 'neutral':
      default:
        return 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border-[var(--color-border)]';
    }
  }

  protected sizeClasses(): string {
    return this.size() === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  }

  protected dotClasses(): string {
    switch (this.variant()) {
      case 'brand':
        return 'bg-[var(--color-brand)]';
      case 'success':
        return 'bg-[var(--color-success)]';
      case 'warning':
        return 'bg-[var(--color-warning)]';
      case 'error':
        return 'bg-[var(--color-error)]';
      case 'info':
        return 'bg-[var(--color-info)]';
      case 'neutral':
      default:
        return 'bg-[var(--color-text-muted)]';
    }
  }
}
