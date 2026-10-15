import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { EmptyStateComponent } from '../../shared/ui/feedback/empty-state.component';

/**
 * AdminDashboardPlaceholderComponent — Scaffold shell for Platform Administration.
 */
@Component({
  selector: 'app-admin-placeholder',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-placeholder.component.html',
  styleUrl: './admin-placeholder.component.css',
})
export class AdminDashboardPlaceholderComponent {}
