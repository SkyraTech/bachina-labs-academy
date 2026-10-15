import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { EmptyStateComponent } from '../../shared/ui/feedback/empty-state.component';

/**
 * AuthorDashboardPlaceholderComponent — Scaffold shell for Author workspace.
 */
@Component({
  selector: 'app-author-placeholder',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './author-placeholder.component.html',
  styleUrl: './author-placeholder.component.css',
})
export class AuthorDashboardPlaceholderComponent {}
