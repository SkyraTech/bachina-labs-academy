import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleMetadataEditorComponent } from './article-metadata-editor.component';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { EditableArticle } from '../../models/article.models';
import { MediaAssetDto } from '../../models/article-media.models';

describe('ArticleMetadataEditorComponent', () => {
  let component: ArticleMetadataEditorComponent;
  let fixture: ComponentFixture<ArticleMetadataEditorComponent>;
  let stateMock: {
    article: ReturnType<typeof vi.fn>;
    isSaving: ReturnType<typeof vi.fn>;
    markDirty: ReturnType<typeof vi.fn>;
    updateMetadata: ReturnType<typeof vi.fn>;
  };
  let mediaApiMock: {
    getPrivateMediaPreviewUrl: ReturnType<typeof vi.fn>;
    listMyMedia: ReturnType<typeof vi.fn>;
  };

  const mockArticle: EditableArticle = {
    id: 'art-1',
    authorId: 'author-1',
    title: 'Enterprise Architecture',
    draftSlug: 'enterprise-architecture',
    publishedSlug: null,
    summary: 'Core principles of software design.',
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
      article: vi.fn().mockReturnValue(mockArticle),
      isSaving: vi.fn().mockReturnValue(false),
      markDirty: vi.fn(),
      updateMetadata: vi.fn().mockResolvedValue(true),
    };

    mediaApiMock = {
      getPrivateMediaPreviewUrl: vi.fn((id: string) => `/api/v1/articles/media/${id}/content`),
      listMyMedia: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleMetadataEditorComponent],
      providers: [
        { provide: ArticleEditorStateService, useValue: stateMock },
        { provide: ArticleMediaApiService, useValue: mediaApiMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleMetadataEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should initialize form with authoritative article values', () => {
    expect(component.form.get('title')?.value).toBe('Enterprise Architecture');
    expect(component.form.get('draftSlug')?.value).toBe('enterprise-architecture');
    expect(component.form.get('summary')?.value).toBe('Core principles of software design.');
    expect(component.form.get('typographyPreset')?.value).toBe('MODERN_SANS');
    expect(component.coverMediaId()).toBeNull();
    expect(component.isDirty()).toBe(false);
  });

  it('2. should detect dirty changes when field values are modified', () => {
    component.form.get('title')?.setValue('Modified Title');

    expect(component.isDirty()).toBe(true);
    expect(stateMock.markDirty).toHaveBeenCalled();
  });

  it('3. should save metadata and reset dirty state on success', async () => {
    component.form.get('title')?.setValue('New Architectural Blueprint');
    component.form.get('draftSlug')?.setValue('new-architectural-blueprint');

    await component.onSave();

    expect(stateMock.updateMetadata).toHaveBeenCalledWith({
      title: 'New Architectural Blueprint',
      draftSlug: 'new-architectural-blueprint',
      summary: 'Core principles of software design.',
      typographyPreset: 'MODERN_SANS',
      coverMediaId: null,
    });
    expect(component.isDirty()).toBe(false);
  });

  it('4. should regenerate slug from current title field', () => {
    component.form.get('title')?.setValue('Production Engineering & Observability');
    component.regenerateSlug();

    expect(component.form.get('draftSlug')?.value).toBe('production-engineering-observability');
  });

  it('5. should save updated typography preset to TECHNICAL_MINIMAL and clear summary with null', async () => {
    component.form.get('typographyPreset')?.setValue('TECHNICAL_MINIMAL');
    component.form.get('summary')?.setValue('');

    await component.onSave();

    expect(stateMock.updateMetadata).toHaveBeenCalledWith({
      title: 'Enterprise Architecture',
      draftSlug: 'enterprise-architecture',
      summary: null,
      typographyPreset: 'TECHNICAL_MINIMAL',
      coverMediaId: null,
    });
    expect(component.isDirty()).toBe(false);
  });

  it('6. should update coverMediaId and mark dirty when media asset is selected', async () => {
    const selectedAsset: MediaAssetDto = {
      id: 'media-cover-123',
      originalFilename: 'architecture.webp',
      mimeType: 'image/webp',
      fileSize: 50000,
      mediaType: 'IMAGE',
      width: null,
      height: null,
      createdAt: '2026-10-26T00:00:00Z',
    };

    component.onCoverSelected(selectedAsset);

    expect(component.coverMediaId()).toBe('media-cover-123');
    expect(component.isPickerOpen()).toBe(false);
    expect(component.isDirty()).toBe(true);
    expect(stateMock.markDirty).toHaveBeenCalled();

    await component.onSave();

    expect(stateMock.updateMetadata).toHaveBeenCalledWith({
      title: 'Enterprise Architecture',
      draftSlug: 'enterprise-architecture',
      summary: 'Core principles of software design.',
      typographyPreset: 'MODERN_SANS',
      coverMediaId: 'media-cover-123',
    });
  });

  it('7. should clear coverMediaId when removeCover is called', () => {
    stateMock.article.mockReturnValue({
      ...mockArticle,
      coverMediaId: 'existing-cover-id',
    });
    component.coverMediaId.set('existing-cover-id');
    component.removeCover();

    expect(component.coverMediaId()).toBeNull();
    expect(component.isDirty()).toBe(true);
    expect(stateMock.markDirty).toHaveBeenCalled();
  });
});
