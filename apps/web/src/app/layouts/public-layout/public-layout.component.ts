import { Component, ChangeDetectionStrategy, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeSelectorComponent } from '../../shared/ui/theme-selector/theme-selector.component';
import { AuthStateService } from '../../core/auth/services/auth-state.service';

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
  private readonly authState = inject(AuthStateService, { optional: true });

  protected readonly mobileMenuOpen = signal(false);

  protected readonly navItems: readonly NavItem[] = [
    { label: 'Home', path: '/' },
    { label: 'Articles', path: '/articles' },
  ];

  readonly isAuthenticated = computed(() => this.authState?.isAuthenticated() ?? false);
  readonly currentUser = computed(() => this.authState?.currentUser() ?? null);
  readonly userRole = computed(() => this.currentUser()?.role);

  readonly workspaceDestination = computed(() => {
    const role = this.userRole();
    if (role === 'ADMIN') return '/admin';
    if (role === 'AUTHOR') return '/author';
    return '/account/security';
  });

  readonly workspaceLabel = computed(() => {
    const role = this.userRole();
    if (role === 'ADMIN') return 'Admin Console';
    if (role === 'AUTHOR') return 'Author Studio';
    return 'My Account';
  });

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.mobileMenuOpen()) {
      this.closeMobileMenu();
    }
  }

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  protected closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
