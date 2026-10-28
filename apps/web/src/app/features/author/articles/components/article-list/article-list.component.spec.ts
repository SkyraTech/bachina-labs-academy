import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticleListComponent } from './article-list.component';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { ToastService } from '../../../../../shared/ui';
import { EditableArticle } from '../../models/article.models';

describe('ArticleListComponent', () => {
  let component: ArticleListComponent;
  let fixture: ComponentFixture<ArticleListComponent>;
  let apiMock: {
    listMyArticles: ReturnType<typeof vi.fn>;
  };
  let toastMock: {
    error: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
  };

  const mockArticles: EditableArticle[] = [
    {
      id: 'art-1',
      authorId: 'usr-1',
      title: 'Architectural Patterns in Modern Angular',
      draftSlug: 'architectural-patterns',
      publishedSlug: 'architectural-patterns',
      summary: 'Exploring zoneless and signals',
      typographyPreset: 'MODERN_SANS',
      status: 'PUBLISHED',
      coverMediaId: null,
      currentSnapshotId: 'snap-1',
      draftRevision: 2,
      publishedRevision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      blocks: [],
    },
    {
      id: 'art-2',
      authorId: 'usr-1',
      title: 'PostgreSQL Indexing Deep Dive',
      draftSlug: 'postgresql-indexing-deep-dive',
      publishedSlug: null,
      summary: null,
      typographyPreset: 'TECHNICAL_MINIMAL',
      status: 'DRAFT',
      coverMediaId: null,
      currentSnapshotId: null,
      draftRevision: 1,
      publishedRevision: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: null,
      blocks: [],
    },
  ];

  beforeEach(async () => {
    apiMock = {
      listMyArticles: vi.fn().mockReturnValue(
        of({
          items: mockArticles,
          total: 2,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      ),
    };

    toastMock = {
      error: vi.fn(),
      success: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleListComponent],
      providers: [
        provideRouter([]),
        { provide: ArticleEditorApiService, useValue: apiMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleListComponent);
    component = fixture.componentInstance;
  });

  it('1. should instantiate and load articles on init', () => {
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component.articles().length).toBe(2);
    expect(component.loading()).toBe(false);
    expect(component.errorMessage()).toBeNull();
  });

  it('2. should render articles and show unpublished edits badge when draftRevision > publishedRevision', () => {
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Architectural Patterns in Modern Angular');
    expect(compiled.textContent).toContain('PostgreSQL Indexing Deep Dive');
    expect(compiled.textContent).toContain('Unpublished Edits');
  });

  it('3. should display empty state when no articles exist', () => {
    apiMock.listMyArticles.mockReturnValue(
      of({
        items: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      }),
    );

    component.loadArticles();
    fixture.detectChanges();

    expect(component.articles().length).toBe(0);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('No articles drafted yet');
  });

  it('4. should display error message and trigger toast on API error', () => {
    apiMock.listMyArticles.mockReturnValue(throwError(() => new Error('Server connection lost')));

    component.loadArticles();
    fixture.detectChanges();

    expect(component.loading()).toBe(false);
    expect(component.errorMessage()).toBe('Server connection lost');
    expect(toastMock.error).toHaveBeenCalledWith('Server connection lost');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Server connection lost');
  });

  it('5. should map status to correct status badge variant', () => {
    expect(component.getStatusVariant('PUBLISHED')).toBe('success');
    expect(component.getStatusVariant('DRAFT')).toBe('neutral');
    expect(component.getStatusVariant('ARCHIVED')).toBe('error');
    expect(component.getStatusVariant('UNKNOWN')).toBe('neutral');
  });
});
