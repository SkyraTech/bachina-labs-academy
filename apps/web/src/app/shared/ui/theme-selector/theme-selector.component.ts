import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService, ResolvedTheme } from '../../../core/theme/theme.service';

interface ThemeOption {
  readonly mode: ResolvedTheme;
  readonly label: string;
}

/**
 * Reusable ThemeSelectorComponent.
 *
 * Implements a compact, accessible 2-choice Light/Dark segmented selector.
 * Reflects effective theme ('light' or 'dark'), supporting automatic system detection.
 */
@Component({
  selector: 'app-theme-selector',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './theme-selector.component.html',
  styleUrl: './theme-selector.component.css',
})
export class ThemeSelectorComponent {
  protected readonly themeService = inject(ThemeService);

  protected readonly options: readonly ThemeOption[] = [
    { mode: 'light', label: 'Light' },
    { mode: 'dark', label: 'Dark' },
  ];

  protected setTheme(mode: ResolvedTheme): void {
    this.themeService.setTheme(mode);
  }
}
