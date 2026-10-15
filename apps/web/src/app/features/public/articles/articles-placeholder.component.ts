import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { EmptyStateComponent } from '../../../shared/ui/feedback/empty-state.component';

/**
 * ArticlesPlaceholderComponent — Public articles index scaffold.
 */
@Component({
  selector: 'app-articles-placeholder',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './articles-placeholder.component.html',
  styleUrl: './articles-placeholder.component.css',
})
export class ArticlesPlaceholderComponent {}
