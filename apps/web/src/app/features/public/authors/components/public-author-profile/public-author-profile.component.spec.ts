import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PublicAuthorProfileComponent } from './public-author-profile.component';
import { PublicAuthorApiService } from '../../services/public-author-api.service';
import { PublicAuthorProfile } from '../../models/public-author.models';
import { PublicArticleListResponse } from '../../../articles/models/public-article.models';

describe('PublicAuthorProfileComponent', () => {
  let component: PublicAuthorProfileComponent;
  let fixture: ComponentFixture<PublicAuthorProfileComponent>;
  let authorApiSpy: {
    getAuthorProfile: ReturnType<typeof vi.fn>;
    getAuthorArticles: ReturnType<typeof vi.fn>;
  };

  const mockProfile: PublicAuthorProfile = {
    id: 'author-uuid-1',
    displayName: 'Test Author',
    publishedArticlesCount: 2,
    joinedAt: '2026-02-15T10:00:00.000Z',
  };

  const mockArticlesResponse: PublicArticleListResponse = {
    items: [
      {
        id: 'article-1',
        slug: 'first-published-article',
        title: 'First Published Article',
        summary: 'A short summary.',
        typographyPreset: 'MODERN_SANS',
        cover: null,
        revision: 1,
        publishedAt: '2026-03-01T12:00:00.000Z',
        taxonomyCaptured: false,
        category: null,
        tags: [],
        author: { id: 'author-uuid-1', displayName: 'Test Author' },
      },
      {
        id: 'article-2',
        slug: 'second-published-article',
        title: 'Second Published Article',
        summary: 'Another summary.',
        typographyPreset: 'TECHNICAL_MINIMAL',
        cover: null,
        revision: 1,
        publishedAt: '2026-03-02T12:00:00.000Z',
        taxonomyCaptured: false,
        category: null,
        tags: [],
        author: { id: 'author-uuid-1', displayName: 'Test Author' },
      },
    ],
    page: 1,
    limit: 12,
    total: 2,
    totalPages: 1,
  };

  beforeEach(async () => {
    authorApiSpy = {
      getAuthorProfile: vi.fn().mockReturnValue(of(mockProfile)),
      getAuthorArticles: vi.fn().mockReturnValue(of(mockArticlesResponse)),
    };

    await TestBed.configureTestingModule({
      imports: [PublicAuthorProfileComponent],
      providers: [
        provideRouter([]),
        { provide: PublicAuthorApiService, useValue: authorApiSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(new Map([['authorId', 'author-uuid-1']])),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicAuthorProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('initializes and renders author public identity', () => {
    expect(authorApiSpy.getAuthorProfile).toHaveBeenCalledWith('author-uuid-1');
    expect(authorApiSpy.getAuthorArticles).toHaveBeenCalledWith('author-uuid-1', { page: 1, limit: 12 });

    const el: HTMLElement = fixture.nativeElement;
    const authorName = el.querySelector('[data-testid="author-name"]');
    expect(authorName?.textContent?.trim()).toBe('Test Author');

    const articleCount = el.querySelector('[data-testid="author-articles-count"]');
    expect(articleCount?.textContent).toContain('2 Articles Published');

    const joinedDate = el.querySelector('[data-testid="author-joined-date"]');
    expect(joinedDate?.textContent).toContain('February 2026');
  });

  it('renders published article cards strictly from response', () => {
    const el: HTMLElement = fixture.nativeElement;
    const cards = el.querySelectorAll('app-public-article-card');
    expect(cards.length).toBe(2);
  });

  it('handles empty published articles gracefully', () => {
    authorApiSpy.getAuthorArticles.mockReturnValue(
      of({ items: [], page: 1, limit: 12, total: 0, totalPages: 0 }),
    );

    component.loadAuthorArticles('author-uuid-1', 1);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const emptyState = el.querySelector('.empty-articles-state');
    expect(emptyState).toBeTruthy();
    expect(emptyState?.textContent).toContain('No published articles yet');
  });

  it('handles 404 author not found gracefully with error message', () => {
    authorApiSpy.getAuthorProfile.mockReturnValue(
      throwError(() => ({ status: 404 })),
    );

    component.loadAuthorProfile('non-existent-id');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const errorAlert = el.querySelector('.profile-error-container');
    expect(errorAlert).toBeTruthy();
    expect(errorAlert?.textContent).toContain('Author not found');
  });

  it('strictly excludes private information from the rendered template', () => {
    const html = fixture.nativeElement.innerHTML;
    expect(html).not.toContain('password');
    expect(html).not.toContain('hash');
    expect(html).not.toContain('session');
    expect(html).not.toContain('token');
    expect(html).not.toContain('@skyra-tech.com');
  });
});
