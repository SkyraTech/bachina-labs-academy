import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';

/**
 * AuthorDashboardPlaceholderComponent — Navigation hub and overview for the Author Studio.
 */
@Component({
  selector: 'app-author-placeholder',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './author-placeholder.component.html',
  styleUrl: './author-placeholder.component.css',
})
export class AuthorDashboardPlaceholderComponent {}
