import { Injectable, signal } from '@angular/core';
import { ToastMessage, ToastType } from '../models/toast.model';

/**
 * Reactive, signal-driven Toast notification service.
 * Handles auto-dismissal, duplicate suppression, and maximum concurrent limits.
 */
@Injectable({
  providedIn: 'root',
})
export class ToastService {
  private readonly maxToasts = 5;
  private readonly duplicateSuppressionWindowMs = 2000;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Active list of visible toast notifications */
  readonly toasts = signal<readonly ToastMessage[]>([]);

  /**
   * Displays a toast notification.
   */
  show(config: {
    type: ToastType;
    message: string;
    title?: string;
    duration?: number;
  }): string {
    const now = Date.now();
    const current = this.toasts();

    // Duplicate suppression check
    const isDuplicate = current.some(
      (t) =>
        t.type === config.type &&
        t.message === config.message &&
        now - t.createdAt < this.duplicateSuppressionWindowMs,
    );

    if (isDuplicate) {
      return '';
    }

    const id = `toast-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const defaultDuration = config.type === 'error' ? 8000 : 5000;
    const duration = config.duration ?? defaultDuration;

    const newToast: ToastMessage = {
      id,
      type: config.type,
      message: config.message,
      title: config.title,
      duration,
      createdAt: now,
    };

    // Prepend new toast and enforce maximum limit
    const updated = [newToast, ...current].slice(0, this.maxToasts);
    this.toasts.set(updated);

    if (duration > 0) {
      const timer = setTimeout(() => {
        this.dismiss(id);
      }, duration);
      this.timers.set(id, timer);
    }

    return id;
  }

  success(message: string, title?: string): string {
    return this.show({ type: 'success', message, title });
  }

  error(message: string, title?: string): string {
    return this.show({ type: 'error', message, title });
  }

  warning(message: string, title?: string): string {
    return this.show({ type: 'warning', message, title });
  }

  info(message: string, title?: string): string {
    return this.show({ type: 'info', message, title });
  }

  /**
   * Dismisses a specific toast by its ID.
   */
  dismiss(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.set(this.toasts().filter((t) => t.id !== id));
  }

  /**
   * Clears all active toasts.
   */
  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.toasts.set([]);
  }
}
