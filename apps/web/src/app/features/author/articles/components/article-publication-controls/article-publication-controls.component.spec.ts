import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ArticlePublicationControlsComponent } from './article-publication-controls.component';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { AcademyDialogService } from '../../../../../shared/ui';
import { EditableArticle } from '../../models/article.models';

describe('ArticlePublicationControlsComponent', () => {
  let component: ArticlePublicationControlsComponent;
  let fixture: ComponentFixture<ArticlePublicationControlsComponent>;
  let stateMock: {
    article: ReturnType<typeof vi.fn>;
    isPublished: ReturnType<typeof vi.fn>;
    isArchived: ReturnType<typeof vi.fn>;
    hasUnpublishedChanges: ReturnType<typeof vi.fn>;
    hasUnsavedChanges: ReturnType<typeof vi.fn>;
    isSaving: ReturnType<typeof vi.fn>;
    currentRevision: ReturnType<typeof vi.fn>;
    publishArticle: ReturnType<typeof vi.fn>;
  };
  let dialogMock: {
    confirm: ReturnType<typeof vi.fn>;
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

  beforeEach(async () => {
    stateMock = {
      article: vi.fn().mockReturnValue(draftArticle),
      isPublished: vi.fn().mockReturnValue(false),
      isArchived: vi.fn().mockReturnValue(false),
      hasUnpublishedChanges: vi.fn().mockReturnValue(false),
      hasUnsavedChanges: vi.fn().mockReturnValue(false),
      isSaving: vi.fn().mockReturnValue(false),
      currentRevision: vi.fn().mockReturnValue(1),
      publishArticle: vi.fn().mockResolvedValue(true),
    };
    dialogMock = {
      confirm: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [ArticlePublicationControlsComponent],
      providers: [
        { provide: ArticleEditorStateService, useValue: stateMock },
        { provide: AcademyDialogService, useValue: dialogMock },
      ],
    }).compileComponents();

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
  });

  it('5. should map status variants accurately', () => {
    expect(component.getStatusVariant('PUBLISHED')).toBe('success');
    expect(component.getStatusVariant('DRAFT')).toBe('neutral');
    expect(component.getStatusVariant('ARCHIVED')).toBe('error');
  });
});
