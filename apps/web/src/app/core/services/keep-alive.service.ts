import { Injectable, inject, DestroyRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { interval } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/**
 * KeepAliveService — Proactive heartbeat service that keeps the backend warm
 * and prevents free-tier container spin-down while users browse the application.
 *
 * Responsibilities:
 * - Sends an immediate health ping on application startup.
 * - Schedules a periodic heartbeat every 4 minutes while browser tab is open (Render sleeps after 15m).
 * - Reacts to visibility changes when the user switches back to the tab.
 * - Fails silently without disturbing application state or user workflow.
 */
@Injectable({ providedIn: 'root' })
export class KeepAliveService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  private started = false;

  start(): void {
    if (this.started || typeof window === 'undefined') {
      return;
    }
    this.started = true;

    // 1. Initial warm-up ping immediately when application loads
    this.ping();

    // 2. Periodic heartbeat every 4 minutes (Render inactivity threshold is 15 minutes)
    interval(4 * 60 * 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.ping();
      });

    // 3. Tab visibility change: if user returns to tab, refresh backend keep-alive
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.ping();
        }
      });
    }
  }

  ping(): void {
    this.http.get('/health', { responseType: 'text' }).subscribe({
      next: () => {},
      error: () => {}, // silently handle, keep-alive is best-effort
    });
  }
}
