import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeSelectorComponent } from '../../shared/ui/theme-selector/theme-selector.component';

interface SidebarItem {
  readonly label: string;
  readonly path: string;
  readonly iconType: 'home' | 'file' | 'pencil' | 'shield' | 'cog';
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
  protected readonly mobileDrawerOpen = signal(false);

  protected readonly sidebarItems: readonly SidebarItem[] = [
    { label: 'Overview', path: '/author', iconType: 'home' },
    { label: 'Articles', path: '/author/articles', iconType: 'file' },
    { label: 'New Draft', path: '/author/articles/new', iconType: 'pencil' },
    { label: 'Admin Hub', path: '/admin', iconType: 'shield' },
    { label: 'Account Security', path: '/account', iconType: 'cog' },
  ];

  protected toggleMobileDrawer(): void {
    this.mobileDrawerOpen.update((open) => !open);
  }

  protected closeMobileDrawer(): void {
    this.mobileDrawerOpen.set(false);
  }
}
