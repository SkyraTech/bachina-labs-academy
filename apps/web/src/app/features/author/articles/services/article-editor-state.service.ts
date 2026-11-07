import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ArticleEditorApiService } from './article-editor-api.service';
import {
  ArticleBlockType,
  EditableArticle,
  SaveState,
  TypographyPreset,
} from '../models/article.models';
import { ToastService } from '../../../../shared/ui';

export interface BlockEditorHandler {
  isValid: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

@Injectable()
export class ArticleEditorStateService {
  private readonly api = inject(ArticleEditorApiService);
  private readonly toast = inject(ToastService);

  readonly article = signal<EditableArticle | null>(null);
  readonly loading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly saveState = signal<SaveState>('SAVED');
  readonly conflictMessage = signal<string | null>(null);
  readonly selectedBlockId = signal<string | null>(null);
  readonly activeTab = signal<'editor' | 'preview'>('editor');

  readonly isBlockDirty = signal<boolean>(false);
  readonly pendingBlockId = signal<string | null>(null);
  readonly showUnsavedSwitchDialog = signal<boolean>(false);

  private blockEditorHandler: BlockEditorHandler | null = null;

  readonly currentRevision = computed(() => this.article()?.draftRevision ?? 1);
  readonly blocks = computed(() => {
    const list = this.article()?.blocks ?? [];
    return [...list].sort((a, b) => a.position - b.position);
  });
  readonly isSaving = computed(() => this.saveState() === 'SAVING');
  readonly hasUnsavedChanges = computed(() => this.saveState() === 'DIRTY');
  readonly isPublished = computed(() => this.article()?.status === 'PUBLISHED');
  readonly isArchived = computed(() => this.article()?.status === 'ARCHIVED');
  readonly hasUnpublishedChanges = computed(() => {
    const a = this.article();
    if (!a || a.status !== 'PUBLISHED') return false;
    return a.draftRevision > a.publishedRevision;
  });

  readonly selectedBlock = computed(() => {
    const id = this.selectedBlockId();
    if (!id) return null;
    return this.blocks().find((b) => b.id === id) ?? null;
  });

  /**
   * Loads an article draft by UUID.
   */
  async loadArticle(articleId: string): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.conflictMessage.set(null);

    try {
      const data = await firstValueFrom(this.api.getArticle(articleId));
      this.article.set(data);
      this.saveState.set('SAVED');
      if (data.blocks.length > 0 && !this.selectedBlockId()) {
        this.selectedBlockId.set(data.blocks[0].id);
      }
    } catch (err: unknown) {
      const msg = this.extractErrorMessage(err, 'Failed to load article draft.');
      this.errorMessage.set(msg);
      this.toast.error(msg);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Updates article metadata (title, draftSlug, summary, typographyPreset, coverMediaId, categoryId, tagIds).
   */
  async updateMetadata(patch: {
    title?: string;
    draftSlug?: string;
    summary?: string | null;
    typographyPreset?: TypographyPreset;
    coverMediaId?: string | null;
    categoryId?: string | null;
    tagIds?: string[];
  }): Promise<boolean> {
    const current = this.article();
    if (!current) return false;

    if (this.isSaving()) {
      return false;
    }

    this.saveState.set('SAVING');
    this.conflictMessage.set(null);

    try {
      const updated = await firstValueFrom(
        this.api.updateDraftMetadata(current.id, {
          expectedRevision: current.draftRevision,
          ...patch,
        }),
      );

      // Preserve existing draft blocks while applying metadata changes
      this.article.set({
        ...current,
        title: updated.title,
        draftSlug: updated.draftSlug,
        summary: updated.summary,
        typographyPreset: updated.typographyPreset as TypographyPreset,
        coverMediaId: updated.coverMediaId,
        categoryId: updated.categoryId,
        tagIds: updated.tagIds,
        category: updated.category,
        tags: updated.tags,
        draftRevision: updated.draftRevision,
        status: updated.status,
        updatedAt: updated.updatedAt,
      });

      this.saveState.set('SAVED');
      this.toast.success('Article metadata saved successfully.');
      return true;
    } catch (err: unknown) {
      this.handleMutationError(err, 'Failed to update article metadata.');
      return false;
    }
  }

  /**
   * Appends a new content block to the article.
   */
  async createBlock(
    type: ArticleBlockType,
    content: Record<string, unknown>,
    mediaAssetId?: string | null,
  ): Promise<boolean> {
    const current = this.article();
    if (!current) return false;

    if (this.isSaving()) return false;

    this.saveState.set('SAVING');
    this.conflictMessage.set(null);

    try {
      const created = await firstValueFrom(
        this.api.createBlock(current.id, {
          expectedRevision: current.draftRevision,
          type,
          content,
          mediaAssetId,
        }),
      );

      const updatedBlocks = [
        ...current.blocks,
        {
          id: created.id,
          articleId: created.articleId,
          type: created.type,
          position: created.position,
          content: created.content,
          mediaAssetId: created.mediaAssetId,
          schemaVersion: created.schemaVersion,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
      ];

      this.article.set({
        ...current,
        draftRevision: created.draftRevision,
        blocks: updatedBlocks,
      });

      this.selectedBlockId.set(created.id);
      this.saveState.set('SAVED');
      this.toast.success(`${type} block added.`);
      return true;
    } catch (err: unknown) {
      this.handleMutationError(err, `Failed to add ${type} block.`);
      return false;
    }
  }

  /**
   * Updates an existing content block.
   */
  async updateBlock(
    blockId: string,
    content: Record<string, unknown>,
    mediaAssetId?: string | null,
  ): Promise<boolean> {
    const current = this.article();
    if (!current) return false;

    if (this.isSaving()) return false;

    this.saveState.set('SAVING');
    this.conflictMessage.set(null);

    try {
      const updated = await firstValueFrom(
        this.api.updateBlock(current.id, blockId, {
          expectedRevision: current.draftRevision,
          content,
          mediaAssetId,
        }),
      );

      const updatedBlocks = current.blocks.map((b) =>
        b.id === blockId
          ? {
              ...b,
              content: updated.content,
              mediaAssetId: updated.mediaAssetId,
              updatedAt: updated.updatedAt,
            }
          : b,
      );

      this.article.set({
        ...current,
        draftRevision: updated.draftRevision,
        blocks: updatedBlocks,
      });

      this.saveState.set('SAVED');
      this.toast.success('Block updated.');
      return true;
    } catch (err: unknown) {
      this.handleMutationError(err, 'Failed to update block.');
      return false;
    }
  }

  /**
   * Deletes a draft block and compacts remaining positions.
   */
  async deleteBlock(blockId: string): Promise<boolean> {
    const current = this.article();
    if (!current) return false;

    if (this.isSaving()) return false;

    this.saveState.set('SAVING');
    this.conflictMessage.set(null);

    try {
      await firstValueFrom(
        this.api.deleteBlock(current.id, blockId, current.draftRevision),
      );

      const remainingBlocks = current.blocks
        .filter((b) => b.id !== blockId)
        .sort((a, b) => a.position - b.position)
        .map((b, index) => ({
          ...b,
          position: index,
        }));

      this.article.set({
        ...current,
        draftRevision: current.draftRevision + 1,
        blocks: remainingBlocks,
      });

      if (this.selectedBlockId() === blockId) {
        this.selectedBlockId.set(remainingBlocks[0]?.id ?? null);
      }

      this.saveState.set('SAVED');
      this.toast.success('Block deleted.');
      return true;
    } catch (err: unknown) {
      this.handleMutationError(err, 'Failed to delete block.');
      return false;
    }
  }

  /**
   * Reorders blocks atomically and reconciles local contiguous positions.
   */
  async reorderBlocks(orderedBlockIds: string[]): Promise<boolean> {
    const current = this.article();
    if (!current) return false;

    if (this.isSaving()) return false;

    this.saveState.set('SAVING');
    this.conflictMessage.set(null);

    try {
      const res = await firstValueFrom(
        this.api.reorderBlocks(current.id, {
          expectedRevision: current.draftRevision,
          blockIds: orderedBlockIds,
        }),
      );

      this.article.set({
        ...current,
        draftRevision: res.draftRevision,
        blocks: res.blocks,
      });

      this.saveState.set('SAVED');
      this.toast.success('Blocks reordered.');
      return true;
    } catch (err: unknown) {
      this.handleMutationError(err, 'Failed to reorder blocks.');
      return false;
    }
  }

  /**
   * Publishes or republishes the article.
   */
  async publishArticle(): Promise<boolean> {
    const current = this.article();
    if (!current) return false;

    if (this.hasUnsavedChanges()) {
      this.toast.error('Please save your pending changes before publishing.');
      return false;
    }

    if (this.isSaving()) return false;

    this.saveState.set('SAVING');
    this.conflictMessage.set(null);

    try {
      const res = await firstValueFrom(
        this.api.publishArticle(current.id, {
          expectedRevision: current.draftRevision,
        }),
      );

      this.article.set({
        ...current,
        status: res.status,
        draftRevision: res.draftRevision,
        publishedRevision: res.publishedRevision,
        publishedSlug: res.publishedSlug,
        currentSnapshotId: res.currentSnapshotId,
        publishedAt: res.publishedAt,
      });

      this.saveState.set('SAVED');
      const actionWord = current.status === 'PUBLISHED' ? 'Republished' : 'Published';
      this.toast.success(`Article ${actionWord} successfully.`);
      return true;
    } catch (err: unknown) {
      this.handleMutationError(err, 'Failed to publish article.');
      return false;
    }
  }

  /**
   * Duplicates the current article into a separate new draft.
   */
  async duplicateArticle(): Promise<EditableArticle | null> {
    const current = this.article();
    if (!current) return null;

    if (this.hasUnsavedChanges()) {
      this.toast.error('Please save your pending changes before duplicating.');
      return null;
    }

    if (this.isSaving()) return null;

    this.saveState.set('SAVING');
    this.conflictMessage.set(null);

    try {
      const duplicated = await firstValueFrom(
        this.api.duplicateArticle(current.id),
      );
      this.saveState.set('SAVED');
      this.toast.success('Article draft duplicated successfully.');
      return duplicated;
    } catch (err: unknown) {
      this.handleMutationError(err, 'Failed to duplicate article.');
      return null;
    }
  }

  /**
   * Marks state as containing unsaved local changes.
   */
  markDirty(): void {
    if (this.saveState() !== 'DIRTY' && this.saveState() !== 'SAVING') {
      this.saveState.set('DIRTY');
    }
  }

  registerBlockEditorHandler(handler: BlockEditorHandler): void {
    this.blockEditorHandler = handler;
  }

  unregisterBlockEditorHandler(): void {
    this.blockEditorHandler = null;
  }

  isCurrentBlockValid(): boolean {
    return this.blockEditorHandler ? this.blockEditorHandler.isValid() : true;
  }

  async saveCurrentBlock(): Promise<boolean> {
    if (!this.blockEditorHandler) return false;
    return this.blockEditorHandler.save();
  }

  discardCurrentBlock(): void {
    if (this.blockEditorHandler) {
      this.blockEditorHandler.discard();
    }
  }

  /**
   * Selects a block by ID for editing.
   * Protects against unsaved changes if the current block is dirty.
   * No-op if selecting the already active block.
   */
  selectBlock(blockId: string | null): void {
    // 1. Same-block selection is a strict no-op
    if (blockId && blockId === this.selectedBlockId()) {
      return;
    }

    // 2. If a save operation is in-flight, ignore block switch attempts
    if (this.isSaving()) {
      return;
    }

    // 3. If current block has unsaved changes, prompt confirmation
    if (this.isBlockDirty()) {
      if (!this.showUnsavedSwitchDialog()) {
        this.pendingBlockId.set(blockId);
        this.showUnsavedSwitchDialog.set(true);
      }
      return;
    }

    // 4. Clean switch
    this.selectedBlockId.set(blockId);
  }

  /**
   * Dismisses unsaved switch confirmation without switching (Keep Editing).
   */
  dismissUnsavedSwitch(): void {
    this.showUnsavedSwitchDialog.set(false);
    this.pendingBlockId.set(null);
  }

  /**
   * Discards unsaved edits in current block and completes the switch to destination.
   */
  discardAndSwitch(): void {
    const destination = this.pendingBlockId();
    this.showUnsavedSwitchDialog.set(false);
    this.pendingBlockId.set(null);

    this.discardCurrentBlock();
    this.isBlockDirty.set(false);

    if (destination) {
      this.selectedBlockId.set(destination);
    }
  }

  /**
   * Saves the current block and switches to the destination block upon confirmed success.
   */
  async saveAndSwitch(): Promise<void> {
    const destination = this.pendingBlockId();

    if (!this.isCurrentBlockValid()) {
      this.showUnsavedSwitchDialog.set(false);
      this.pendingBlockId.set(null);
      this.toast.error('Cannot save block: Please fix validation errors before switching.');
      return;
    }

    const success = await this.saveCurrentBlock();
    if (success) {
      this.showUnsavedSwitchDialog.set(false);
      this.pendingBlockId.set(null);
      this.isBlockDirty.set(false);
      if (destination) {
        this.selectedBlockId.set(destination);
      }
    } else {
      // Save failed or 409 conflict: keep edits intact on current block
      this.showUnsavedSwitchDialog.set(false);
      this.pendingBlockId.set(null);
    }
  }

  /**
   * Toggles between editor and draft preview mode.
   */
  setTab(tab: 'editor' | 'preview'): void {
    this.activeTab.set(tab);
  }

  /**
   * Dismisses conflict banner and reloads latest authoritative state.
   */
  async reloadAuthoritativeState(): Promise<void> {
    const current = this.article();
    if (current) {
      await this.loadArticle(current.id);
    }
  }

  private handleMutationError(err: unknown, defaultMessage: string): void {
    if (err instanceof HttpErrorResponse && err.status === 409) {
      this.saveState.set('CONFLICT');
      const conflictMsg =
        'Revision Conflict (409): This draft was updated by another action or session. Please reload to review current changes before resubmitting.';
      this.conflictMessage.set(conflictMsg);
      this.toast.error(conflictMsg);
      return;
    }

    this.saveState.set('ERROR');
    const msg = this.extractErrorMessage(err, defaultMessage);
    this.errorMessage.set(msg);
    this.toast.error(msg);
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.error?.message) {
        if (Array.isArray(err.error.message)) {
          return err.error.message.join(', ');
        }
        return String(err.error.message);
      }
      if (err.status === 404) {
        return 'Article not found or you do not have permission to view it.';
      }
      if (err.status === 403) {
        return 'You do not have permission to perform this authoring action.';
      }
      if (err.status === 401) {
        return 'Session expired. Please sign in again.';
      }
    }
    if (err instanceof Error) {
      return err.message;
    }
    return fallback;
  }
}
