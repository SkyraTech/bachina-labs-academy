import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticleListComponent } from './article-list.component';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { AcademyDialogService, ToastService } from '../../../../../shared/ui';
import { EditableArticle } from '../../models/article.models';

describe('ArticleListComponent', () => {
  let component: ArticleListComponent;
  let fixture: ComponentFixture<ArticleListComponent>;
  let router: Router;
  let apiMock: {
    listMyArticles: ReturnType<typeof vi.fn>;
    duplicateArticle: ReturnType<typeof vi.fn>;
    deleteArticle: ReturnType<typeof vi.fn>;
    archiveArticle: ReturnType<typeof vi.fn>;
    restoreArticle: ReturnType<typeof vi.fn>;
  };
  let dialogMock: {
    confirm: ReturnType<typeof vi.fn>;
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
    {
      id: 'art-3',
      authorId: 'usr-1',
      title: 'Legacy Docker Swarm Setup',
      draftSlug: 'legacy-docker-swarm-setup',
      publishedSlug: 'legacy-docker-swarm-setup',
      summary: 'Deprecated setup guide',
      typographyPreset: 'EDITORIAL_SERIF',
      status: 'ARCHIVED',
      coverMediaId: null,
      currentSnapshotId: 'snap-archived-1',
      draftRevision: 5,
      publishedRevision: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      blocks: [],
    },
  ];

  beforeEach(async () => {
    apiMock = {
      listMyArticles: vi.fn().mockReturnValue(
        of({
          items: mockArticles,
          total: 3,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      ),
      duplicateArticle: vi.fn().mockReturnValue(
        of({
          ...mockArticles[0],
          id: 'dup-999',
          title: 'Architectural Patterns in Modern Angular (Copy)',
        }),
      ),
      deleteArticle: vi.fn().mockReturnValue(of(undefined)),
      archiveArticle: vi.fn().mockReturnValue(
        of({
          articleId: mockArticles[0].id,
          status: 'ARCHIVED',
          draftRevision: 3,
          publishedRevision: 1,
          publishedSlug: 'architectural-patterns',
          currentSnapshotId: 'snap-1',
          publishedAt: mockArticles[0].publishedAt,
        }),
      ),
      restoreArticle: vi.fn().mockReturnValue(
        of({
          articleId: 'art-3',
          status: 'PUBLISHED',
          draftRevision: 6,
          publishedRevision: 4,
          publishedSlug: 'legacy-docker-swarm-setup',
          currentSnapshotId: 'snap-archived-1',
          publishedAt: new Date().toISOString(),
        }),
      ),
    };

    dialogMock = {
      confirm: vi.fn().mockResolvedValue(true),
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
        { provide: AcademyDialogService, useValue: dialogMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(ArticleListComponent);
    component = fixture.componentInstance;
  });

  it('1. should instantiate and load articles on init', () => {
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component.articles().length).toBe(3);
    expect(component.loading()).toBe(false);
    expect(component.errorMessage()).toBeNull();
  });

  it('2. should render articles and show unpublished edits badge when draftRevision > publishedRevision', () => {
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Architectural Patterns in Modern Angular');
    expect(compiled.textContent).toContain('PostgreSQL Indexing Deep Dive');
    expect(compiled.textContent).toContain('Legacy Docker Swarm Setup');
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

  it('6. should confirm before duplicating and navigate to new draft edit route', async () => {
    fixture.detectChanges();

    await component.onDuplicate(mockArticles[0]);

    expect(dialogMock.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Duplicate Article',
    }));
    expect(apiMock.duplicateArticle).toHaveBeenCalledWith(mockArticles[0].id);
    expect(toastMock.success).toHaveBeenCalledWith('Article duplicated successfully.');
    expect(router.navigate).toHaveBeenCalledWith(['/author/articles', 'dup-999', 'edit']);
  });

  it('7. should abort duplication if confirmation cancelled', async () => {
    fixture.detectChanges();
    dialogMock.confirm.mockResolvedValue(false);

    await component.onDuplicate(mockArticles[0]);

    expect(apiMock.duplicateArticle).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('8. should accurately determine isDeletable for draft vs published vs archived articles', () => {
    expect(component.isDeletable(mockArticles[0])).toBe(false); // PUBLISHED
    expect(component.isDeletable(mockArticles[1])).toBe(true); // DRAFT without snapshot/publishedRevision
    expect(component.isDeletable(mockArticles[2])).toBe(false); // ARCHIVED

    const draftWithSnapshot: EditableArticle = {
      ...mockArticles[1],
      currentSnapshotId: 'snap-old',
    };
    expect(component.isDeletable(draftWithSnapshot)).toBe(false);

    const draftWithPublishedRevision: EditableArticle = {
      ...mockArticles[1],
      publishedRevision: 1,
    };
    expect(component.isDeletable(draftWithPublishedRevision)).toBe(false);

    const draftWithPublishedSlug: EditableArticle = {
      ...mockArticles[1],
      publishedSlug: 'some-slug',
    };
    expect(component.isDeletable(draftWithPublishedSlug)).toBe(false);
  });

  it('9. should render Delete button for eligible drafts and omit it for published and archived articles', () => {
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const deleteButtons = compiled.querySelectorAll('[data-testid="delete-article-btn"]');
    expect(deleteButtons.length).toBe(1);
    expect(deleteButtons[0].textContent).toContain('Delete');
  });

  it('10. should confirm before deleting and dispatch delete request with expectedRevision', async () => {
    fixture.detectChanges();

    await component.onDelete(mockArticles[1]);

    expect(dialogMock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete Draft Article',
        message: expect.stringContaining(mockArticles[1].title),
        confirmLabel: 'Delete Draft',
        destructive: true,
      }),
    );
    expect(apiMock.deleteArticle).toHaveBeenCalledWith(mockArticles[1].id, mockArticles[1].draftRevision);
    expect(toastMock.success).toHaveBeenCalledWith('Draft article deleted successfully.');
    expect(component.articles().find((a) => a.id === mockArticles[1].id)).toBeUndefined();
    expect(component.articles().length).toBe(2);
  });

  it('11. should abort deletion if confirmation dialog is cancelled', async () => {
    fixture.detectChanges();
    dialogMock.confirm.mockResolvedValue(false);

    await component.onDelete(mockArticles[1]);

    expect(apiMock.deleteArticle).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(component.articles().length).toBe(3);
  });

  it('12. should handle deletion API error, show error toast, and refresh articles', async () => {
    fixture.detectChanges();
    apiMock.deleteArticle.mockReturnValue(
      throwError(() => ({ error: { message: 'Article is locked by another process' } })),
    );

    await component.onDelete(mockArticles[1]);

    expect(apiMock.deleteArticle).toHaveBeenCalledWith(mockArticles[1].id, mockArticles[1].draftRevision);
    expect(toastMock.error).toHaveBeenCalledWith('Article is locked by another process');
    expect(component.deletingId()).toBeNull();
  });

  it('13. should calculate tab counts accurately across All, Drafts, Published, and Archived', () => {
    fixture.detectChanges();

    expect(component.tabCounts()).toEqual({
      all: 3,
      draft: 1,
      published: 1,
      archived: 1,
    });
  });

  it('14. should render all four filter tabs with accurate counts', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const tabAll = compiled.querySelector('[data-testid="tab-all"]');
    const tabDraft = compiled.querySelector('[data-testid="tab-draft"]');
    const tabPublished = compiled.querySelector('[data-testid="tab-published"]');
    const tabArchived = compiled.querySelector('[data-testid="tab-archived"]');

    expect(tabAll).toBeTruthy();
    expect(tabDraft).toBeTruthy();
    expect(tabPublished).toBeTruthy();
    expect(tabArchived).toBeTruthy();

    expect(tabAll?.textContent).toContain('All');
    expect(tabAll?.textContent).toContain('3');
    expect(tabDraft?.textContent).toContain('Drafts');
    expect(tabDraft?.textContent).toContain('1');
    expect(tabPublished?.textContent).toContain('Published');
    expect(tabPublished?.textContent).toContain('1');
    expect(tabArchived?.textContent).toContain('Archived');
    expect(tabArchived?.textContent).toContain('1');
  });

  it('15. should filter articles by active tab (DRAFT)', () => {
    fixture.detectChanges();

    component.setTab('DRAFT');
    fixture.detectChanges();

    expect(component.filteredArticles().length).toBe(1);
    expect(component.filteredArticles()[0].id).toBe('art-2');

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="article-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('PostgreSQL Indexing Deep Dive');
  });

  it('16. should filter articles by active tab (PUBLISHED)', () => {
    fixture.detectChanges();

    component.setTab('PUBLISHED');
    fixture.detectChanges();

    expect(component.filteredArticles().length).toBe(1);
    expect(component.filteredArticles()[0].id).toBe('art-1');

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="article-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Architectural Patterns in Modern Angular');
  });

  it('17. should filter articles by active tab (ARCHIVED)', () => {
    fixture.detectChanges();

    component.setTab('ARCHIVED');
    fixture.detectChanges();

    expect(component.filteredArticles().length).toBe(1);
    expect(component.filteredArticles()[0].id).toBe('art-3');

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="article-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Legacy Docker Swarm Setup');
  });

  it('18. should display tab-specific empty state when selected tab has no matching articles', () => {
    fixture.detectChanges();

    // Override with only published article (no archived)
    apiMock.listMyArticles.mockReturnValue(
      of({
        items: [mockArticles[0]],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      }),
    );
    component.articles.set([mockArticles[0]]);
    component.setTab('ARCHIVED');
    fixture.detectChanges();

    expect(component.filteredArticles().length).toBe(0);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('No archived articles');
  });

  it('19. should render Archive button on PUBLISHED article and omit on DRAFT / ARCHIVED', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const archiveButtons = compiled.querySelectorAll('[data-testid="archive-article-btn"]');
    expect(archiveButtons.length).toBe(1); // Only for art-1
    expect(archiveButtons[0].textContent).toContain('Archive');
  });

  it('20. should render Restore button on ARCHIVED article and omit on DRAFT / PUBLISHED', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const restoreButtons = compiled.querySelectorAll('[data-testid="restore-article-btn"]');
    expect(restoreButtons.length).toBe(1); // Only for art-3
    expect(restoreButtons[0].textContent).toContain('Restore');
  });

  it('21. should render View Live button ONLY for PUBLISHED article with slug', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const viewLiveButtons = compiled.querySelectorAll('[data-testid="view-live-btn"]');
    expect(viewLiveButtons.length).toBe(1); // Only art-1, not art-2 (no slug) or art-3 (archived)
  });

  it('22. should confirm and call archiveArticle with expectedRevision on onArchive', async () => {
    fixture.detectChanges();

    await component.onArchive(mockArticles[0]);

    expect(dialogMock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Archive Article?',
        message: expect.stringContaining(
          'Archive this Article? It will immediately disappear from Academy public listings, and its public URL will return 404',
        ),
        confirmLabel: 'Archive Article',
      }),
    );
    expect(apiMock.archiveArticle).toHaveBeenCalledWith(mockArticles[0].id, mockArticles[0].draftRevision);
    expect(toastMock.success).toHaveBeenCalledWith(
      expect.stringContaining('archived successfully'),
    );
    expect(apiMock.listMyArticles).toHaveBeenCalledTimes(2); // Initial load + reload after archive
  });

  it('23. should abort archive if dialog cancelled', async () => {
    fixture.detectChanges();
    dialogMock.confirm.mockResolvedValue(false);

    await component.onArchive(mockArticles[0]);

    expect(apiMock.archiveArticle).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('24. should confirm and call restoreArticle with expectedRevision on onRestore', async () => {
    fixture.detectChanges();

    await component.onRestore(mockArticles[2]);

    expect(dialogMock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Restore Article?',
        confirmLabel: 'Restore Article',
      }),
    );
    expect(apiMock.restoreArticle).toHaveBeenCalledWith(mockArticles[2].id, mockArticles[2].draftRevision);
    expect(toastMock.success).toHaveBeenCalledWith(
      expect.stringContaining('restored to published status'),
    );
    expect(apiMock.listMyArticles).toHaveBeenCalledTimes(2);
  });

  it('25. should abort restore if dialog cancelled', async () => {
    fixture.detectChanges();
    dialogMock.confirm.mockResolvedValue(false);

    await component.onRestore(mockArticles[2]);

    expect(apiMock.restoreArticle).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('26. should handle archive error, display error toast, and reload articles', async () => {
    fixture.detectChanges();
    apiMock.archiveArticle.mockReturnValue(
      throwError(() => ({ error: { message: 'Revision conflict detected' } })),
    );

    await component.onArchive(mockArticles[0]);

    expect(toastMock.error).toHaveBeenCalledWith('Revision conflict detected');
    expect(component.archivingId()).toBeNull();
    expect(apiMock.listMyArticles).toHaveBeenCalledTimes(2);
  });

  it('27. should handle restore error, display error toast, and reload articles', async () => {
    fixture.detectChanges();
    apiMock.restoreArticle.mockReturnValue(
      throwError(() => ({ error: { message: 'Restore conflict detected' } })),
    );

    await component.onRestore(mockArticles[2]);

    expect(toastMock.error).toHaveBeenCalledWith('Restore conflict detected');
    expect(component.restoringId()).toBeNull();
    expect(apiMock.listMyArticles).toHaveBeenCalledTimes(2);
  });

  it('28. should report isActionInProgress accurately when archiving, restoring, duplicating, or deleting', () => {
    expect(component.isActionInProgress('art-1')).toBe(false);

    component.archivingId.set('art-1');
    expect(component.isActionInProgress('art-1')).toBe(true);
    expect(component.isActionInProgress('art-2')).toBe(false);

    component.archivingId.set(null);
    component.restoringId.set('art-3');
    expect(component.isActionInProgress('art-3')).toBe(true);
    expect(component.isActionInProgress('art-1')).toBe(false);
  });

  it('29. should update search query, reset page to 1, and reload articles on search input', async () => {
    vi.useFakeTimers();
    fixture.detectChanges();

    component.onSearchInput('Angular');
    expect(component.searchInput()).toBe('Angular');

    // Advance debounce timer
    vi.advanceTimersByTime(350);

    expect(component.searchQuery()).toBe('Angular');
    expect(component.currentPage()).toBe(1);
    expect(apiMock.listMyArticles).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'Angular',
        page: 1,
      }),
    );
    vi.useRealTimers();
  });

  it('30. should immediately clear search query and reload articles on clearSearch', () => {
    fixture.detectChanges();
    component.searchInput.set('Angular');
    component.searchQuery.set('Angular');

    component.clearSearch();

    expect(component.searchInput()).toBe('');
    expect(component.searchQuery()).toBe('');
    expect(component.currentPage()).toBe(1);
    expect(apiMock.listMyArticles).toHaveBeenCalledWith(
      expect.not.objectContaining({
        search: 'Angular',
      }),
    );
  });

  it('31. should filter articles by category and reload page 1', () => {
    fixture.detectChanges();

    component.onCategoryChange('cat-123');

    expect(component.selectedCategoryId()).toBe('cat-123');
    expect(component.currentPage()).toBe(1);
    expect(apiMock.listMyArticles).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: 'cat-123',
        page: 1,
      }),
    );
  });

  it('32. should change page size, reset to page 1, and reload articles', () => {
    fixture.detectChanges();

    component.onPageSizeChange(50);

    expect(component.pageSize()).toBe(50);
    expect(component.currentPage()).toBe(1);
    expect(apiMock.listMyArticles).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        page: 1,
      }),
    );
  });

  it('33. should navigate across pages with goToPage, prevPage, and nextPage', () => {
    apiMock.listMyArticles.mockReturnValue(
      of({
        items: mockArticles,
        total: 50,
        page: 2,
        limit: 20,
        totalPages: 3,
      }),
    );
    fixture.detectChanges();
    component.totalArticles.set(50);
    component.totalPages.set(3);
    component.currentPage.set(2);

    component.prevPage();
    expect(component.currentPage()).toBe(1);
    expect(apiMock.listMyArticles).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
    );

    // Mock response for page 1 that still has 3 totalPages
    apiMock.listMyArticles.mockReturnValue(
      of({
        items: mockArticles,
        total: 50,
        page: 1,
        limit: 20,
        totalPages: 3,
      }),
    );
    component.nextPage();
    expect(component.currentPage()).toBe(2);
    expect(apiMock.listMyArticles).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it('34. should render pagination controls and summary when totalArticles > 0', () => {
    apiMock.listMyArticles.mockReturnValue(
      of({
        items: mockArticles,
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
      }),
    );
    component.currentPage.set(2);
    component.pageSize.set(20);
    fixture.detectChanges();

    expect(component.showingStart()).toBe(21);
    expect(component.showingEnd()).toBe(40);

    const compiled = fixture.nativeElement as HTMLElement;
    const summary = compiled.querySelector('[data-testid="pagination-summary"]');
    expect(summary?.textContent).toContain('Showing 21–40 of 45 articles');

    const prevBtn = compiled.querySelector('[data-testid="prev-page-btn"]') as HTMLButtonElement;
    const nextBtn = compiled.querySelector('[data-testid="next-page-btn"]') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(false);
    expect(nextBtn.disabled).toBe(false);
  });
});
