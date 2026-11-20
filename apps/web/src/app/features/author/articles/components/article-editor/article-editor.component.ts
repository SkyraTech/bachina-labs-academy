import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { A11yModule } from '@angular/cdk/a11y';
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
import { AcademyDialogService } from '../../../../../shared/ui';

@Component({
  selector: 'app-article-editor',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    A11yModule,
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
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(AcademyDialogService);
  readonly state = inject(ArticleEditorStateService);

  readonly mobileTab = signal<'outline' | 'content' | 'settings'>('content');

  private pendingNavigationPromise: Promise<boolean> | null = null;
  private beforeUnloadListenerAttached = false;

  readonly onBeforeUnloadFn = (event: BeforeUnloadEvent): void => {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  };

  constructor() {
    if (typeof window !== 'undefined') {
      effect(() => {
        const isDirty = this.state.hasUnsavedChanges();
        if (isDirty && !this.beforeUnloadListenerAttached) {
          window.addEventListener('beforeunload', this.onBeforeUnloadFn);
          this.beforeUnloadListenerAttached = true;
        } else if (!isDirty && this.beforeUnloadListenerAttached) {
          window.removeEventListener('beforeunload', this.onBeforeUnloadFn);
          this.beforeUnloadListenerAttached = false;
        }
      });

      this.destroyRef.onDestroy(() => {
        if (this.beforeUnloadListenerAttached) {
          window.removeEventListener('beforeunload', this.onBeforeUnloadFn);
          this.beforeUnloadListenerAttached = false;
        }
      });
    }
  }

  hasUnsavedChanges(): boolean {
    return this.state.hasUnsavedChanges();
  }

  async canDeactivate(): Promise<boolean> {
    if (!this.hasUnsavedChanges()) {
      return true;
    }

    if (this.pendingNavigationPromise) {
      return this.pendingNavigationPromise;
    }

    this.pendingNavigationPromise = (async () => {
      try {
        const discard = await this.dialog.confirm({
          title: 'Unsaved changes',
          message:
            "You have changes that haven't been saved. If you leave this page, those changes will be lost.",
          confirmLabel: 'Discard changes and leave',
          cancelLabel: 'Stay and continue editing',
          type: 'danger',
          destructive: true,
          closable: true,
          dismissableMask: true,
        });

        if (discard) {
          this.state.discardAllChanges();
          return true;
        }

        return false;
      } finally {
        this.pendingNavigationPromise = null;
      }
    })();

    return this.pendingNavigationPromise;
  }

  async openFullPagePreview(): Promise<void> {
    const article = this.state.article();
    if (!article) return;

    if (!this.hasUnsavedChanges()) {
      await this.router.navigate(['/author/articles', article.id, 'preview']);
      return;
    }

    const proceed = await this.dialog.confirm({
      title: 'Save changes before preview?',
      message:
        'You have unsaved changes. To view the full-page preview, your changes must be saved to the server first.',
      confirmLabel: 'Save & Preview',
      cancelLabel: 'Cancel',
      type: 'info',
      closable: true,
      dismissableMask: true,
    });

    if (!proceed) {
      return;
    }

    const saved = await this.state.saveAllPendingChanges();
    if (saved) {
      await this.router.navigate(['/author/articles', article.id, 'preview']);
    }
  }

  ngOnInit(): void {
    if (this.route.paramMap) {
      this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        const articleId = params.get('articleId');
        if (articleId) {
          this.state.loadArticle(articleId);
        }
      });
    } else {
      const articleId = this.route.snapshot?.paramMap?.get('articleId');
      if (articleId) {
        this.state.loadArticle(articleId);
      }
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
