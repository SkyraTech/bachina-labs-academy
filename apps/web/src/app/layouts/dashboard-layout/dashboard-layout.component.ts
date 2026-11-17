import { Component, ChangeDetectionStrategy, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ThemeSelectorComponent } from '../../shared/ui/theme-selector/theme-selector.component';
import { AuthStateService } from '../../core';
import { ToastService } from '../../shared/ui';

interface SidebarItem {
  readonly label: string;
  readonly path: string;
  readonly iconType: 'home' | 'file' | 'pencil' | 'shield' | 'cog' | 'users' | 'chat' | 'tag';
}

/**
 * DashboardLayoutComponent — Shell for Author, Admin, and Account workspaces.
 */
@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, ThemeSelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-layout.component.html',
  styleUrl: './dashboard-layout.component.css',
})
export class DashboardLayoutComponent {
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly mobileDrawerOpen = signal(false);
  protected readonly signingOut = signal(false);
  protected readonly isStudioEditRoute = signal(this.matchesStudioEditRoute(this.router.url));

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        this.isStudioEditRoute.set(this.matchesStudioEditRoute(e.urlAfterRedirects || e.url));
      });
  }

  private matchesStudioEditRoute(url: string): boolean {
    return /^\/author\/articles\/[^/]+\/edit(?:[?#]|$)/.test(url || '');
  }

  readonly currentUser = this.authState.currentUser;
  readonly userEmail = computed(() => this.currentUser()?.email ?? '');
  readonly userInitial = computed(() => {
    const email = this.userEmail();
    return (email.charAt(0) || 'U').toUpperCase();
  });
  readonly userRole = computed(() => this.currentUser()?.role ?? '');
  readonly workspaceBadge = computed(() => {
    return this.userRole() === 'ADMIN' ? 'Admin Workspace' : 'Studio Workspace';
  });

  protected readonly sidebarItems = computed<readonly SidebarItem[]>(() => {
    const role = this.userRole();

    if (role === 'ADMIN') {
      return [
        { label: 'Admin Hub', path: '/admin', iconType: 'shield' },
        { label: 'Users', path: '/admin/users', iconType: 'users' },
        { label: 'Articles', path: '/admin/articles', iconType: 'file' },
        { label: 'Comments', path: '/admin/comments', iconType: 'chat' },
        { label: 'Categories', path: '/admin/categories', iconType: 'tag' },
        { label: 'Tags', path: '/admin/tags', iconType: 'tag' },
        { label: 'Account Security', path: '/account/security', iconType: 'cog' },
      ];
    }

    return [
      { label: 'Overview', path: '/author', iconType: 'home' },
      { label: 'Articles', path: '/author/articles', iconType: 'file' },
      { label: 'New Draft', path: '/author/articles/new', iconType: 'pencil' },
      { label: 'Account Security', path: '/account/security', iconType: 'cog' },
    ];
  });

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.mobileDrawerOpen()) {
      this.closeMobileDrawer();
    }
  }

  protected toggleMobileDrawer(): void {
    this.mobileDrawerOpen.update((open) => !open);
  }

  protected closeMobileDrawer(): void {
    this.mobileDrawerOpen.set(false);
  }

  protected onSignOut(): void {
    if (this.signingOut()) return;
    this.signingOut.set(true);

    this.authState.logout().subscribe({
      next: () => {
        this.signingOut.set(false);
        this.toastService.success('You have been signed out.');
        this.router.navigate(['/login']);
      },
      error: () => {
        this.signingOut.set(false);
        this.toastService.error('Sign out completed with local session cleared.');
        this.router.navigate(['/login']);
      },
    });
  }
}
