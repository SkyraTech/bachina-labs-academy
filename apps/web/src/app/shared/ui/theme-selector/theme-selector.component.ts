import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService, ThemeMode } from '../../../core/theme/theme.service';

interface ThemeOption {
  readonly mode: ThemeMode;
  readonly label: string;
}

/**
 * Reusable ThemeSelectorComponent.
 *
 * Implements a sleek micro-segmented control styled after modern SaaS platforms (Linear, Raycast).
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
    { mode: 'system', label: 'System' },
  ];

  protected setTheme(mode: ThemeMode): void {
    this.themeService.setTheme(mode);
  }
}
