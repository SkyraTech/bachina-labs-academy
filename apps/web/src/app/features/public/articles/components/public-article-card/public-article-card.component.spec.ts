import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ComponentRef } from '@angular/core';
import { PublicArticleCardComponent } from './public-article-card.component';
import { PublicArticleItem } from '../../models/public-article.models';

describe('PublicArticleCardComponent', () => {
  let component: PublicArticleCardComponent;
  let componentRef: ComponentRef<PublicArticleCardComponent>;
  let fixture: ComponentFixture<PublicArticleCardComponent>;

  const mockArticle: PublicArticleItem = {
    id: 'art-101',
    slug: 'scaling-postgresql-read-replicas',
    title: 'Scaling PostgreSQL with Read Replicas',
    summary: 'A comprehensive guide to configuring hot standby replicas in production.',
    typographyPreset: 'TECHNICAL_MINIMAL',
    cover: null,
    revision: 3,
    publishedAt: '2026-10-25T14:30:00.000Z',
    taxonomyCaptured: true,
    category: null,
    tags: [],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicArticleCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicArticleCardComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('article', mockArticle);
    fixture.detectChanges();
  });

  it('should instantiate the component with external template and styles', () => {
    expect(component).toBeTruthy();
  });

  it('should render article title, summary, and revision', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h2')?.textContent).toContain(
      'Scaling PostgreSQL with Read Replicas',
    );
    expect(compiled.textContent).toContain(
      'A comprehensive guide to configuring hot standby replicas in production.',
    );
    expect(compiled.textContent).toContain('Rev 3');
  });

  it('should display the typography badge label correctly', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Technical Minimal');
  });

  it('should render graceful placeholder when cover url is null', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const img = compiled.querySelector('img');
    expect(img).toBeNull();
    expect(compiled.textContent).toContain('Bachina Labs Academy');
  });

  it('should render image element when cover url is present', () => {
    const articleWithCover: PublicArticleItem = {
      ...mockArticle,
      cover: {
        id: 'media-1',
        mimeType: 'image/webp',
        width: 1200,
        height: 630,
        altText: 'PostgreSQL Architecture Diagram',
        url: 'https://images.example.com/postgres.webp',
      },
    };

    componentRef.setInput('article', articleWithCover);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const img = compiled.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://images.example.com/postgres.webp');
    expect(img?.getAttribute('alt')).toBe('PostgreSQL Architecture Diagram');
  });

  it('should link to public article detail route via slug', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const links = compiled.querySelectorAll('a');
    const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.includes('/articles/scaling-postgresql-read-replicas'))).toBe(
      true,
    );
  });

  it('should render category and tag links when taxonomyCaptured is true', () => {
    const articleWithTaxonomy: PublicArticleItem = {
      ...mockArticle,
      taxonomyCaptured: true,
      category: {
        id: 'cat-1',
        name: 'Database Architecture',
        slug: 'database-architecture',
      },
      tags: [
        { id: 'tag-1', name: 'PostgreSQL', slug: 'postgresql' },
        { id: 'tag-2', name: 'Replication', slug: 'replication' },
      ],
    };

    componentRef.setInput('article', articleWithTaxonomy);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Database Architecture');
    expect(compiled.textContent).toContain('#PostgreSQL');
    expect(compiled.textContent).toContain('#Replication');

    const catBadge = compiled.querySelector('.category-badge');
    expect(catBadge).not.toBeNull();
    expect(catBadge?.getAttribute('href')).toContain('/articles?category=database-architecture');

    const tagBadges = compiled.querySelectorAll('.tag-badge');
    expect(tagBadges.length).toBe(2);
    expect(tagBadges[0].getAttribute('href')).toContain('/articles?tag=postgresql');
  });

  it('should not fabricate taxonomy when taxonomyCaptured is false (legacy unknown)', () => {
    const legacyArticle: PublicArticleItem = {
      ...mockArticle,
      taxonomyCaptured: false,
      category: null,
      tags: [],
    };

    componentRef.setInput('article', legacyArticle);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.category-badge')).toBeNull();
    expect(compiled.querySelector('.tag-badge')).toBeNull();
    expect(compiled.textContent).not.toContain('Uncategorized');
  });

  it('should generate correct detail links for published articles with slug categories or tags', () => {
    const specialSlugArticle: PublicArticleItem = {
      ...mockArticle,
      slug: 'categories',
      title: 'Taxonomy Categories in Action',
      summary: null,
    };

    componentRef.setInput('article', specialSlugArticle);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const links = compiled.querySelectorAll('a');
    const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.includes('/articles/categories'))).toBe(true);
  });

  describe('Accessibility & Landmark Semantics (Checkpoint C-3D)', () => {
    it('sets aria-labelledby referencing the article heading id', () => {
      const articleEl = fixture.nativeElement.querySelector('article');
      expect(articleEl).not.toBeNull();
      expect(articleEl.getAttribute('aria-labelledby')).toBe('article-title-art-101');

      const heading = fixture.nativeElement.querySelector('#article-title-art-101');
      expect(heading).not.toBeNull();
      expect(heading.tagName).toBe('H2');
    });

    it('provides accessible aria-label on the read article link', () => {
      const readLink = fixture.nativeElement.querySelector('footer a');
      expect(readLink).not.toBeNull();
      expect(readLink.getAttribute('aria-label')).toBe(
        'Read article: Scaling PostgreSQL with Read Replicas',
      );
    });

    it('renders datetime attribute on time element with published date', () => {
      const timeEl = fixture.nativeElement.querySelector('time');
      expect(timeEl).not.toBeNull();
      expect(timeEl.getAttribute('datetime')).toBe('2026-10-25T14:30:00.000Z');
    });
  });
});
