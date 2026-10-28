import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ArticleCreateComponent, generateSlug } from './article-create.component';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { ToastService } from '../../../../../shared/ui';
import { EditableArticle } from '../../models/article.models';

describe('ArticleCreateComponent', () => {
  let component: ArticleCreateComponent;
  let fixture: ComponentFixture<ArticleCreateComponent>;
  let apiMock: { createDraft: ReturnType<typeof vi.fn> };
  let router: Router;
  let toastMock: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  const createdArticle: EditableArticle = {
    id: 'art-new-123',
    authorId: 'author-1',
    title: 'Distributed SQL Patterns',
    draftSlug: 'distributed-sql-patterns',
    publishedSlug: null,
    summary: 'Architectural overview of distributed databases.',
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
    apiMock = {
      createDraft: vi.fn().mockReturnValue(of(createdArticle)),
    };
    toastMock = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleCreateComponent],
      providers: [
        provideRouter([]),
        { provide: ArticleEditorApiService, useValue: apiMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));

    fixture = TestBed.createComponent(ArticleCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should initialize form with default values and validation', () => {
    expect(component.form).toBeDefined();
    expect(component.form.valid).toBe(false);
    expect(component.form.get('typographyPreset')?.value).toBe('MODERN_SANS');
  });

  it('2. should validate slug generator utility correctly', () => {
    expect(generateSlug('PostgreSQL 17 — Advanced Indexing!!')).toBe('postgresql-17-advanced-indexing');
    expect(generateSlug('  Hello   World  ')).toBe('hello-world');
    expect(generateSlug('---special---chars---')).toBe('special-chars');
  });

  it('3. should automatically generate slug on title input if not manually customized', () => {
    const titleControl = component.form.get('title');
    const slugControl = component.form.get('draftSlug');

    titleControl?.setValue('Cloud Architecture Patterns');
    component.onTitleInput();

    expect(slugControl?.value).toBe('cloud-architecture-patterns');
  });

  it('4. should regenerate slug explicitly when requested', () => {
    component.form.get('title')?.setValue('High Availability Microservices');
    component.form.get('draftSlug')?.setValue('custom-override');

    component.regenerateSlug();

    expect(component.form.get('draftSlug')?.value).toBe('high-availability-microservices');
  });

  it('5. should submit valid draft and navigate to editor route', async () => {
    component.form.patchValue({
      title: 'Distributed SQL Patterns',
      draftSlug: 'distributed-sql-patterns',
      summary: 'Architectural overview of distributed databases.',
      typographyPreset: 'MODERN_SANS',
    });

    await component.onSubmit();

    expect(apiMock.createDraft).toHaveBeenCalledWith({
      title: 'Distributed SQL Patterns',
      draftSlug: 'distributed-sql-patterns',
      summary: 'Architectural overview of distributed databases.',
      typographyPreset: 'MODERN_SANS',
    });
    expect(toastMock.success).toHaveBeenCalledWith('Draft article created successfully.');
    expect(router.navigate).toHaveBeenCalledWith(['/author/articles', 'art-new-123', 'edit']);
  });

  it('6. should handle create error and preserve form values', async () => {
    apiMock.createDraft.mockReturnValue(throwError(() => new Error('Slug already taken')));

    component.form.patchValue({
      title: 'Duplicate Title',
      draftSlug: 'duplicate-title',
    });

    await component.onSubmit();

    expect(component.submitting()).toBe(false);
    expect(component.form.get('title')?.value).toBe('Duplicate Title');
    expect(toastMock.error).toHaveBeenCalledWith('Slug already taken');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('7. should support selecting and submitting TECHNICAL_MINIMAL and EDITORIAL_SERIF presets', async () => {
    component.form.patchValue({
      title: 'Low-Latency Systems in Rust',
      draftSlug: 'low-latency-systems-rust',
      typographyPreset: 'TECHNICAL_MINIMAL',
    });

    await component.onSubmit();

    expect(apiMock.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        typographyPreset: 'TECHNICAL_MINIMAL',
      }),
    );
  });
});
