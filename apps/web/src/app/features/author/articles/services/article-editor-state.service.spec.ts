import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ArticleEditorStateService } from './article-editor-state.service';
import { ArticleEditorApiService } from './article-editor-api.service';
import { ToastService } from '../../../../shared/ui';
import { EditableArticle } from '../models/article.models';

describe('ArticleEditorStateService', () => {
  let service: ArticleEditorStateService;
  let apiMock: {
    getArticle: ReturnType<typeof vi.fn>;
    updateDraftMetadata: ReturnType<typeof vi.fn>;
    createBlock: ReturnType<typeof vi.fn>;
    updateBlock: ReturnType<typeof vi.fn>;
    deleteBlock: ReturnType<typeof vi.fn>;
    reorderBlocks: ReturnType<typeof vi.fn>;
    publishArticle: ReturnType<typeof vi.fn>;
  };
  let toastMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  const mockArticle: EditableArticle = {
    id: 'art-100',
    authorId: 'user-1',
    title: 'PostgreSQL Distributed Architecture',
    draftSlug: 'postgresql-distributed-architecture',
    publishedSlug: null,
    summary: 'A deep dive into distributed tables.',
    status: 'DRAFT',
    typographyPreset: 'MODERN_SANS',
    coverMediaId: null,
    draftRevision: 1,
    publishedRevision: 0,
    currentSnapshotId: null,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
    publishedAt: null,
    blocks: [
      {
        id: 'block-1',
        articleId: 'art-100',
        type: 'HEADING',
        position: 0,
        content: { text: 'Introduction', level: 2 },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      },
      {
        id: 'block-2',
        articleId: 'art-100',
        type: 'RICH_TEXT',
        position: 1,
        content: { html: '<p>Content</p>' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      },
    ],
  };

  beforeEach(() => {
    apiMock = {
      getArticle: vi.fn().mockReturnValue(of(mockArticle)),
      updateDraftMetadata: vi.fn(),
      createBlock: vi.fn(),
      updateBlock: vi.fn(),
      deleteBlock: vi.fn(),
      reorderBlocks: vi.fn(),
      publishArticle: vi.fn(),
    };
    toastMock = {
      success: vi.fn(),
      error: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ArticleEditorStateService,
        { provide: ArticleEditorApiService, useValue: apiMock },
        { provide: ToastService, useValue: toastMock },
      ],
    });

    service = TestBed.inject(ArticleEditorStateService);
  });

  it('1. should load article draft and initialize state', async () => {
    await service.loadArticle('art-100');

    expect(service.article()).toEqual(mockArticle);
    expect(service.currentRevision()).toBe(1);
    expect(service.saveState()).toBe('SAVED');
    expect(service.selectedBlockId()).toBe('block-1');
    expect(service.blocks().length).toBe(2);
  });

  it('2. should handle load error gracefully', async () => {
    apiMock.getArticle.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })),
    );

    await service.loadArticle('art-non-existent');

    expect(service.article()).toBeNull();
    expect(service.errorMessage()).toContain('Article not found');
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('3. should update metadata and advance revision', async () => {
    await service.loadArticle('art-100');

    const updatedResponse: EditableArticle = {
      ...mockArticle,
      title: 'Updated Title',
      draftRevision: 2,
    };
    apiMock.updateDraftMetadata.mockReturnValue(of(updatedResponse));

    const result = await service.updateMetadata({ title: 'Updated Title' });

    expect(result).toBe(true);
    expect(apiMock.updateDraftMetadata).toHaveBeenCalledWith('art-100', {
      expectedRevision: 1,
      title: 'Updated Title',
    });
    expect(service.article()?.title).toBe('Updated Title');
    expect(service.currentRevision()).toBe(2);
    expect(service.saveState()).toBe('SAVED');
  });

  it('4. should handle 409 conflict during metadata update', async () => {
    await service.loadArticle('art-100');

    apiMock.updateDraftMetadata.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, statusText: 'Conflict' })),
    );

    const result = await service.updateMetadata({ title: 'Conflicting Title' });

    expect(result).toBe(false);
    expect(service.saveState()).toBe('CONFLICT');
    expect(service.conflictMessage()).toContain('409');
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('Revision Conflict'));
  });

  it('5. should create new block and advance revision', async () => {
    await service.loadArticle('art-100');

    const newBlock = {
      id: 'block-3',
      articleId: 'art-100',
      type: 'CODE' as const,
      position: 2,
      content: { code: 'SELECT 1;' },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-25T11:00:00Z',
      updatedAt: '2026-10-25T11:00:00Z',
      draftRevision: 2,
    };
    apiMock.createBlock.mockReturnValue(of(newBlock));

    const success = await service.createBlock('CODE', { code: 'SELECT 1;' });

    expect(success).toBe(true);
    expect(apiMock.createBlock).toHaveBeenCalledWith('art-100', {
      expectedRevision: 1,
      type: 'CODE',
      content: { code: 'SELECT 1;' },
      mediaAssetId: undefined,
    });
    expect(service.blocks().length).toBe(3);
    expect(service.currentRevision()).toBe(2);
    expect(service.selectedBlockId()).toBe('block-3');
  });

  it('6. should update block and advance revision', async () => {
    await service.loadArticle('art-100');

    const updatedBlockResponse = {
      id: 'block-1',
      articleId: 'art-100',
      type: 'HEADING' as const,
      position: 0,
      content: { text: 'Updated Heading', level: 2 },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-25T11:30:00Z',
      draftRevision: 2,
    };
    apiMock.updateBlock.mockReturnValue(of(updatedBlockResponse));

    const success = await service.updateBlock('block-1', { text: 'Updated Heading', level: 2 });

    expect(success).toBe(true);
    expect(apiMock.updateBlock).toHaveBeenCalledWith('art-100', 'block-1', {
      expectedRevision: 1,
      content: { text: 'Updated Heading', level: 2 },
      mediaAssetId: undefined,
    });
    expect(service.blocks()[0].content).toEqual({ text: 'Updated Heading', level: 2 });
    expect(service.currentRevision()).toBe(2);
  });

  it('7. should delete block and reconcile remaining positions', async () => {
    await service.loadArticle('art-100');

    apiMock.deleteBlock.mockReturnValue(of(undefined));

    const success = await service.deleteBlock('block-1');

    expect(success).toBe(true);
    expect(apiMock.deleteBlock).toHaveBeenCalledWith('art-100', 'block-1', 1);
    expect(service.blocks().length).toBe(1);
    expect(service.blocks()[0].id).toBe('block-2');
    expect(service.blocks()[0].position).toBe(0); // position compacted contiguously
    expect(service.currentRevision()).toBe(2);
  });

  it('8. should reorder blocks and reconcile state', async () => {
    await service.loadArticle('art-100');

    const reorderedBlocks = [
      { ...mockArticle.blocks[1], position: 0 },
      { ...mockArticle.blocks[0], position: 1 },
    ];
    apiMock.reorderBlocks.mockReturnValue(of({ blocks: reorderedBlocks, draftRevision: 2 }));

    const success = await service.reorderBlocks(['block-2', 'block-1']);

    expect(success).toBe(true);
    expect(apiMock.reorderBlocks).toHaveBeenCalledWith('art-100', {
      expectedRevision: 1,
      blockIds: ['block-2', 'block-1'],
    });
    expect(service.blocks()[0].id).toBe('block-2');
    expect(service.currentRevision()).toBe(2);
  });

  it('9. should publish article and update published revisions', async () => {
    await service.loadArticle('art-100');

    const publishResponse = {
      articleId: 'art-100',
      status: 'PUBLISHED' as const,
      draftRevision: 2,
      publishedRevision: 2,
      publishedSlug: 'postgresql-distributed-architecture',
      currentSnapshotId: 'snap-1',
      publishedAt: '2026-10-25T12:00:00Z',
    };
    apiMock.publishArticle.mockReturnValue(of(publishResponse));

    const success = await service.publishArticle();

    expect(success).toBe(true);
    expect(service.isPublished()).toBe(true);
    expect(service.article()?.publishedRevision).toBe(2);
    expect(service.hasUnpublishedChanges()).toBe(false);
  });

  it('10. should prevent publication when unsaved changes exist', async () => {
    await service.loadArticle('art-100');
    service.markDirty();

    expect(service.hasUnsavedChanges()).toBe(true);

    const success = await service.publishArticle();

    expect(success).toBe(false);
    expect(apiMock.publishArticle).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith('Please save your pending changes before publishing.');
  });
});
