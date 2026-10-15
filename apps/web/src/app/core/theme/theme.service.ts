import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'bla-theme';

/**
 * ThemeService — manages light/dark/system theme preference.
 *
 * Uses `data-theme` attribute on <html> element to drive CSS token switching.
 * Persists user preference in localStorage; falls back to system preference.
 * Safe for SSR and JSDOM environments.
 *
 * Usage:
 *   inject(ThemeService).setTheme('dark')
 *   inject(ThemeService).resolvedTheme() // 'light' | 'dark' (signal)
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  /** User's explicit preference (or 'system' for auto). */
  readonly mode = signal<ThemeMode>(this.loadStoredMode());

  /** Resolved actual theme applied to the DOM. */
  readonly resolvedTheme = signal<ResolvedTheme>(this.resolveTheme(this.loadStoredMode()));

  constructor() {
    if (this.isBrowser) {
      this.applyTheme(this.mode());

      // Listen for OS-level theme changes when mode is 'system'
      if (typeof window.matchMedia === 'function') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener?.('change', () => {
          if (this.mode() === 'system') {
            const resolved = mediaQuery.matches ? 'dark' : 'light';
            this.resolvedTheme.set(resolved);
            this.applyToDocument(resolved);
          }
        });
      }
    }
  }

  setTheme(mode: ThemeMode): void {
    this.mode.set(mode);
    const resolved = this.resolveTheme(mode);
    this.resolvedTheme.set(resolved);

    if (this.isBrowser) {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
      this.applyToDocument(resolved);
    }
  }

  private applyTheme(mode: ThemeMode): void {
    const resolved = this.resolveTheme(mode);
    this.resolvedTheme.set(resolved);
    this.applyToDocument(resolved);
  }

  private applyToDocument(resolved: ResolvedTheme): void {
    if (this.isBrowser) {
      document.documentElement.setAttribute('data-theme', resolved);
    }
  }

  private resolveTheme(mode: ThemeMode): ResolvedTheme {
    if (mode === 'system') {
      if (this.isBrowser && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return 'light'; // SSR or JSDOM default
    }
    return mode;
  }

  private loadStoredMode(): ThemeMode {
    if (this.isBrowser) {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    }
    return 'system'; // default to system preference
  }
}
