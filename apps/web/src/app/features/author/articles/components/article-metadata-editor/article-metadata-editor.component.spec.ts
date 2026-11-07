import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { ArticleMetadataEditorComponent } from './article-metadata-editor.component';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { TaxonomyApiService } from '../../../../../core/taxonomy/services/taxonomy-api.service';
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
  let taxonomyApiMock: {
    getCategories: ReturnType<typeof vi.fn>;
    getTags: ReturnType<typeof vi.fn>;
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
    categoryId: 'cat-1',
    tagIds: ['tag-1', 'tag-2'],
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

    taxonomyApiMock = {
      getCategories: vi.fn().mockReturnValue(of({ items: [], total: 0, page: 1, limit: 100 })),
      getTags: vi.fn().mockReturnValue(of({ items: [], total: 0, page: 1, limit: 100 })),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleMetadataEditorComponent],
      providers: [
        { provide: ArticleEditorStateService, useValue: stateMock },
        { provide: ArticleMediaApiService, useValue: mediaApiMock },
        { provide: TaxonomyApiService, useValue: taxonomyApiMock },
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
    expect(component.categoryId()).toBe('cat-1');
    expect(component.tagIds()).toEqual(['tag-1', 'tag-2']);
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
      categoryId: 'cat-1',
      tagIds: ['tag-1', 'tag-2'],
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
      categoryId: 'cat-1',
      tagIds: ['tag-1', 'tag-2'],
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
      categoryId: 'cat-1',
      tagIds: ['tag-1', 'tag-2'],
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

  it('8. should update categoryId and mark dirty when category changes', async () => {
    component.onCategoryChanged('cat-2');

    expect(component.categoryId()).toBe('cat-2');
    expect(component.isDirty()).toBe(true);
    expect(stateMock.markDirty).toHaveBeenCalled();

    await component.onSave();

    expect(stateMock.updateMetadata).toHaveBeenCalledWith({
      title: 'Enterprise Architecture',
      draftSlug: 'enterprise-architecture',
      summary: 'Core principles of software design.',
      typographyPreset: 'MODERN_SANS',
      coverMediaId: null,
      categoryId: 'cat-2',
      tagIds: ['tag-1', 'tag-2'],
    });
  });

  it('9. should update tagIds and mark dirty when tags change', async () => {
    component.onTagsChanged(['tag-1', 'tag-3']);

    expect(component.tagIds()).toEqual(['tag-1', 'tag-3']);
    expect(component.isDirty()).toBe(true);
    expect(stateMock.markDirty).toHaveBeenCalled();

    await component.onSave();

    expect(stateMock.updateMetadata).toHaveBeenCalledWith({
      title: 'Enterprise Architecture',
      draftSlug: 'enterprise-architecture',
      summary: 'Core principles of software design.',
      typographyPreset: 'MODERN_SANS',
      coverMediaId: null,
      categoryId: 'cat-1',
      tagIds: ['tag-1', 'tag-3'],
    });
  });

  it('10. should clear categoryId with actual JavaScript null and clear all tags with empty array', async () => {
    component.onCategoryChanged(null);
    component.onTagsChanged([]);

    expect(component.categoryId()).toBeNull();
    expect(component.tagIds()).toEqual([]);
    expect(component.isDirty()).toBe(true);

    await component.onSave();

    expect(stateMock.updateMetadata).toHaveBeenCalledWith({
      title: 'Enterprise Architecture',
      draftSlug: 'enterprise-architecture',
      summary: 'Core principles of software design.',
      typographyPreset: 'MODERN_SANS',
      coverMediaId: null,
      categoryId: null,
      tagIds: [],
    });
    expect(component.isDirty()).toBe(false);
  });

  it('11. should preserve unsaved dirty state and field values if updateMetadata fails', async () => {
    stateMock.updateMetadata.mockResolvedValue(false);

    component.onCategoryChanged('cat-modified');
    component.onTagsChanged(['tag-99']);

    expect(component.isDirty()).toBe(true);

    await component.onSave();

    expect(stateMock.updateMetadata).toHaveBeenCalled();
    expect(component.isDirty()).toBe(true);
    expect(component.categoryId()).toBe('cat-modified');
    expect(component.tagIds()).toEqual(['tag-99']);
  });

  it('12. should preserve categoryId and tagIds when saving unrelated metadata edits while controls are disabled', async () => {
    // 1. Initial article has categoryId: 'cat-1' and tagIds: ['tag-1', 'tag-2']
    expect(component.categoryId()).toBe('cat-1');
    expect(component.tagIds()).toEqual(['tag-1', 'tag-2']);

    // 2. Author only edits summary in the form
    component.form.get('summary')?.setValue('Updated summary without touching taxonomy');
    component.form.get('summary')?.markAsDirty();

    // 3. Save metadata
    await component.onSave();

    // 4. Assert that categoryId and tagIds were preserved bit-for-bit
    expect(stateMock.updateMetadata).toHaveBeenCalledWith({
      title: 'Enterprise Architecture',
      draftSlug: 'enterprise-architecture',
      summary: 'Updated summary without touching taxonomy',
      typographyPreset: 'MODERN_SANS',
      coverMediaId: null,
      categoryId: 'cat-1',
      tagIds: ['tag-1', 'tag-2'],
    });
    expect(component.categoryId()).toBe('cat-1');
    expect(component.tagIds()).toEqual(['tag-1', 'tag-2']);
  });
});
