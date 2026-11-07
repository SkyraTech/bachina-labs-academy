import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal, WritableSignal } from '@angular/core';
import { ArticlePublicationControlsComponent } from './article-publication-controls.component';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { AcademyDialogService, ToastService } from '../../../../../shared/ui';
import { EditableArticle, ArticleBlock } from '../../models/article.models';

describe('ArticlePublicationControlsComponent', () => {
  let component: ArticlePublicationControlsComponent;
  let fixture: ComponentFixture<ArticlePublicationControlsComponent>;
  let router: Router;
  let articleSignal: WritableSignal<EditableArticle | null>;
  let blocksSignal: WritableSignal<ArticleBlock[]>;
  let stateMock: {
    article: WritableSignal<EditableArticle | null>;
    blocks: WritableSignal<ArticleBlock[]>;
    isPublished: ReturnType<typeof vi.fn>;
    isArchived: ReturnType<typeof vi.fn>;
    hasUnpublishedChanges: ReturnType<typeof vi.fn>;
    hasUnsavedChanges: ReturnType<typeof vi.fn>;
    isSaving: ReturnType<typeof vi.fn>;
    currentRevision: ReturnType<typeof vi.fn>;
    publishArticle: ReturnType<typeof vi.fn>;
    duplicateArticle: ReturnType<typeof vi.fn>;
  };
  let dialogMock: {
    confirm: ReturnType<typeof vi.fn>;
  };
  let toastMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  const draftArticle: EditableArticle = {
    id: 'art-draft',
    authorId: 'auth-1',
    title: 'Draft Article',
    draftSlug: 'draft-article',
    publishedSlug: null,
    summary: 'A draft article.',
    status: 'DRAFT',
    typographyPreset: 'MODERN_SANS',
    coverMediaId: null,
    draftRevision: 1,
    publishedRevision: 0,
    currentSnapshotId: null,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
    publishedAt: null,
    blocks: [],
  };

  const validBlocks: ArticleBlock[] = [
    {
      id: 'blk-1',
      articleId: 'art-draft',
      type: 'RICH_TEXT',
      position: 1000,
      content: { html: '<p>Content</p>' },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-25T10:00:00Z',
    },
  ];

  beforeEach(async () => {
    articleSignal = signal<EditableArticle | null>(draftArticle);
    blocksSignal = signal<ArticleBlock[]>(validBlocks);

    stateMock = {
      article: articleSignal,
      blocks: blocksSignal,
      isPublished: vi.fn().mockReturnValue(false),
      isArchived: vi.fn().mockReturnValue(false),
      hasUnpublishedChanges: vi.fn().mockReturnValue(false),
      hasUnsavedChanges: vi.fn().mockReturnValue(false),
      isSaving: vi.fn().mockReturnValue(false),
      currentRevision: vi.fn().mockReturnValue(1),
      publishArticle: vi.fn().mockResolvedValue(true),
      duplicateArticle: vi.fn().mockResolvedValue({
        ...draftArticle,
        id: 'dup-123',
        title: 'Draft Article (Copy)',
      }),
    };
    dialogMock = {
      confirm: vi.fn().mockResolvedValue(true),
    };
    toastMock = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ArticlePublicationControlsComponent],
      providers: [
        provideRouter([]),
        { provide: ArticleEditorStateService, useValue: stateMock },
        { provide: AcademyDialogService, useValue: dialogMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(ArticlePublicationControlsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should show initial publish action for draft article', () => {
    expect(component.state.isPublished()).toBe(false);
    expect(component.getStatusVariant('DRAFT')).toBe('neutral');
  });

  it('2. should confirm before publishing', async () => {
    await component.onPublish();

    expect(dialogMock.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Publish Article',
    }));
    expect(stateMock.publishArticle).toHaveBeenCalled();
  });

  it('3. should abort publication if dialog cancelled', async () => {
    dialogMock.confirm.mockResolvedValue(false);

    await component.onPublish();

    expect(stateMock.publishArticle).not.toHaveBeenCalled();
  });

  it('4. should prevent publication when unsaved changes exist', async () => {
    stateMock.hasUnsavedChanges.mockReturnValue(true);

    await component.onPublish();

    expect(dialogMock.confirm).not.toHaveBeenCalled();
    expect(stateMock.publishArticle).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith('Please save your pending changes before publishing.');
  });

  it('5. should map status variants accurately', () => {
    expect(component.getStatusVariant('PUBLISHED')).toBe('success');
    expect(component.getStatusVariant('DRAFT')).toBe('neutral');
    expect(component.getStatusVariant('ARCHIVED')).toBe('error');
  });

  it('6. should detect publication readiness issues when title is too short or blocks empty', () => {
    articleSignal.set({
      ...draftArticle,
      title: 'ab',
    });
    blocksSignal.set([]);

    const readiness = component.publicationReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toContain('Title must be at least 3 characters after trimming.');
    expect(readiness.issues).toContain('Article must contain at least one content block.');
  });

  it('7. should compute canonical public URL and relative path when published', () => {
    articleSignal.set({
      ...draftArticle,
      status: 'PUBLISHED',
      publishedSlug: 'database-indexing-guide',
    });

    expect(component.publicRelativePath()).toBe('/articles/database-indexing-guide');
    expect(component.publicUrl()).toContain('/articles/database-indexing-guide');
  });

  it('8. should copy public link to clipboard and show success feedback', async () => {
    articleSignal.set({
      ...draftArticle,
      status: 'PUBLISHED',
      publishedSlug: 'database-indexing-guide',
    });

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });

    await component.onCopyLink();

    expect(writeTextSpy).toHaveBeenCalledWith(component.publicUrl());
    expect(toastMock.success).toHaveBeenCalledWith('Public article link copied to clipboard!');
    expect(component.copiedLink()).toBe(true);
  });

  it('9. should confirm before duplicating and navigate to new draft route', async () => {
    await component.onDuplicate();

    expect(dialogMock.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Duplicate Article',
    }));
    expect(stateMock.duplicateArticle).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/author/articles', 'dup-123', 'edit']);
  });

  it('10. should abort duplicate if confirmation cancelled', async () => {
    dialogMock.confirm.mockResolvedValue(false);

    await component.onDuplicate();

    expect(stateMock.duplicateArticle).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('11. should prevent duplication if unsaved changes exist', async () => {
    stateMock.hasUnsavedChanges.mockReturnValue(true);

    await component.onDuplicate();

    expect(dialogMock.confirm).not.toHaveBeenCalled();
    expect(stateMock.duplicateArticle).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith('Please save your pending changes before duplicating.');
  });
});
