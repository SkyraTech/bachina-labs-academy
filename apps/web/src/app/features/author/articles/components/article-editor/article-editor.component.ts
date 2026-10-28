import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleBlockListComponent } from '../article-block-list/article-block-list.component';
import { ArticleBlockEditorComponent } from '../article-block-editor/article-block-editor.component';
import { ArticleMetadataEditorComponent } from '../article-metadata-editor/article-metadata-editor.component';
import { ArticlePublicationControlsComponent } from '../article-publication-controls/article-publication-controls.component';
import { ArticlePreviewComponent } from '../article-preview/article-preview.component';
import { LoadingSkeletonComponent } from '../../../../../shared/ui/loading/loading-skeleton.component';
import {
  StatusBadgeComponent,
  StatusVariant,
} from '../../../../../shared/ui/status-badge/status-badge.component';

@Component({
  selector: 'app-article-editor',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ArticleBlockListComponent,
    ArticleBlockEditorComponent,
    ArticleMetadataEditorComponent,
    ArticlePublicationControlsComponent,
    ArticlePreviewComponent,
    LoadingSkeletonComponent,
    StatusBadgeComponent,
  ],
  providers: [ArticleEditorStateService],
  templateUrl: './article-editor.component.html',
  styleUrl: './article-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleEditorComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(ArticleEditorStateService);

  readonly mobileTab = signal<'outline' | 'content' | 'settings'>('content');

  ngOnInit(): void {
    const articleId = this.route.snapshot.paramMap.get('articleId');
    if (articleId) {
      this.state.loadArticle(articleId);
    }
  }

  getStatusVariant(status: string): StatusVariant {
    switch (status) {
      case 'PUBLISHED':
        return 'success';
      case 'DRAFT':
        return 'neutral';
      case 'ARCHIVED':
        return 'error';
      default:
        return 'neutral';
    }
  }
}
