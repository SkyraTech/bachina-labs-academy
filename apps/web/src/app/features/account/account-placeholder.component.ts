import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { EmptyStateComponent } from '../../shared/ui/feedback/empty-state.component';

/**
 * AccountPlaceholderComponent — Scaffold shell for Account Settings & Active Sessions.
 */
@Component({
  selector: 'app-account-placeholder',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-placeholder.component.html',
  styleUrl: './account-placeholder.component.css',
})
export class AccountPlaceholderComponent {}
