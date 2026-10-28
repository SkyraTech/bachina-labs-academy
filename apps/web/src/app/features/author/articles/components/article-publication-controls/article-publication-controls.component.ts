import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import {
  StatusBadgeComponent,
  StatusVariant,
} from '../../../../../shared/ui/status-badge/status-badge.component';
import { AcademyDialogService } from '../../../../../shared/ui';

@Component({
  selector: 'app-article-publication-controls',
  standalone: true,
  imports: [CommonModule, StatusBadgeComponent],
  templateUrl: './article-publication-controls.component.html',
  styleUrl: './article-publication-controls.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticlePublicationControlsComponent {
  readonly state = inject(ArticleEditorStateService);
  private readonly dialog = inject(AcademyDialogService);

  async onPublish(): Promise<void> {
    if (this.state.hasUnsavedChanges() || this.state.isSaving()) return;

    const isRepublish = this.state.isPublished();
    const actionLabel = isRepublish ? 'Republish Changes' : 'Publish Article';
    const message = isRepublish
      ? `This will create a new immutable publication snapshot for draft revision ${this.state.currentRevision()} and deploy it to readers. Continue?`
      : 'This will publish your article to readers and create an immutable publication snapshot. Continue?';

    const confirmed = await this.dialog.confirm({
      title: actionLabel,
      message,
      confirmLabel: actionLabel,
      cancelLabel: 'Keep Draft',
    });

    if (confirmed) {
      await this.state.publishArticle();
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
