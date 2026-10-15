import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeSelectorComponent } from '../../shared/ui/theme-selector/theme-selector.component';

interface NavItem {
  readonly label: string;
  readonly path: string;
}

/**
 * PublicLayoutComponent — Premium SaaS platform layout shell.
 */
@Component({
  selector: 'app-public-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, ThemeSelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './public-layout.component.html',
  styleUrl: './public-layout.component.css',
})
export class PublicLayoutComponent {
  protected readonly mobileMenuOpen = signal(false);

  protected readonly navItems: readonly NavItem[] = [
    { label: 'Home', path: '/' },
    { label: 'Articles', path: '/articles' },
  ];

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  protected closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
