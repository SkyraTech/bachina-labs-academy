import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import {
  StatusBadgeComponent,
  StatusVariant,
} from '../../../../../shared/ui/status-badge/status-badge.component';
import { AcademyDialogService, ToastService } from '../../../../../shared/ui';

@Component({
  selector: 'app-article-publication-controls',
  standalone: true,
  imports: [CommonModule, RouterLink, StatusBadgeComponent],
  templateUrl: './article-publication-controls.component.html',
  styleUrl: './article-publication-controls.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticlePublicationControlsComponent {
  readonly state = inject(ArticleEditorStateService);
  private readonly dialog = inject(AcademyDialogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly copiedLink = signal<boolean>(false);
  readonly duplicating = signal<boolean>(false);

  /**
   * Evaluates draft readiness for publication against backend constraints.
   */
  readonly publicationReadiness = computed(() => {
    const art = this.state.article();
    const blocks = this.state.blocks();
    const issues: string[] = [];

    if (!art) {
      return { ready: false, issues: ['Article data is not loaded.'] };
    }

    if (!art.title || art.title.trim().length < 3) {
      issues.push('Title must be at least 3 characters after trimming.');
    }

    const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    if (!art.draftSlug || art.draftSlug.length < 3 || !slugRegex.test(art.draftSlug)) {
      issues.push('Draft slug must be valid lowercase alphanumeric with hyphens (3-280 chars).');
    }

    if (!blocks || blocks.length === 0) {
      issues.push('Article must contain at least one content block.');
    } else {
      const hasNonDivider = blocks.some((b) => b.type !== 'DIVIDER');
      if (!hasNonDivider) {
        issues.push('Article must contain at least one non-divider content block.');
      }
    }

    return {
      ready: issues.length === 0,
      issues,
    };
  });

  /**
   * Resolves the canonical public URL for a published article snapshot.
   */
  readonly publicUrl = computed(() => {
    const slug = this.state.article()?.publishedSlug;
    if (!slug) return '';
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/articles/${encodeURIComponent(slug)}`;
    }
    return `/articles/${encodeURIComponent(slug)}`;
  });

  /**
   * Resolves the relative public path for internal router links.
   */
  readonly publicRelativePath = computed(() => {
    const slug = this.state.article()?.publishedSlug;
    return slug ? `/articles/${encodeURIComponent(slug)}` : '';
  });

  async onPublish(): Promise<void> {
    if (this.state.hasUnsavedChanges()) {
      this.toast.error('Please save your pending changes before publishing.');
      return;
    }

    if (this.state.isSaving()) return;

    const readiness = this.publicationReadiness();
    if (!readiness.ready) {
      this.toast.error(readiness.issues[0] || 'Article is not ready to publish.');
      return;
    }

    const isRepublish = this.state.isPublished();
    const actionLabel = isRepublish ? 'Republish Changes' : 'Publish Article';
    const art = this.state.article();
    const title = art?.title ?? 'this article';

    const message = isRepublish
      ? `Republishing "${title}" will freeze draft revision ${this.state.currentRevision()} into a new immutable publication snapshot and deploy it to readers. Later draft edits will not affect the live snapshot until republished. Continue?`
      : `Publishing "${title}" will create an immutable public snapshot and deploy it to readers at "/articles/${art?.draftSlug}". Later draft edits will remain private until republished. Continue?`;

    const confirmed = await this.dialog.confirm({
      title: actionLabel,
      message,
      confirmLabel: actionLabel,
      cancelLabel: 'Cancel',
    });

    if (confirmed) {
      await this.state.publishArticle();
    }
  }

  async onCopyLink(): Promise<void> {
    const url = this.publicUrl();
    if (!url) return;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for restricted clipboard contexts
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      this.copiedLink.set(true);
      this.toast.success('Public article link copied to clipboard!');
      setTimeout(() => this.copiedLink.set(false), 2500);
    } catch {
      this.toast.error('Failed to copy public link to clipboard.');
    }
  }

  async onDuplicate(): Promise<void> {
    if (this.state.hasUnsavedChanges()) {
      this.toast.error('Please save your pending changes before duplicating.');
      return;
    }

    if (this.duplicating() || this.state.isSaving()) return;

    const art = this.state.article();
    const title = art?.title ?? 'this article';

    const confirmed = await this.dialog.confirm({
      title: 'Duplicate Article',
      message: `Create an independent draft copy of "${title}"? All content blocks and taxonomy tags will be cloned. The duplicate will have its own identity and will not be published.`,
      confirmLabel: 'Duplicate Article',
      cancelLabel: 'Cancel',
    });

    if (!confirmed) return;

    this.duplicating.set(true);
    try {
      const duplicated = await this.state.duplicateArticle();
      if (duplicated) {
        await this.router.navigate(['/author/articles', duplicated.id, 'edit']);
      }
    } finally {
      this.duplicating.set(false);
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
