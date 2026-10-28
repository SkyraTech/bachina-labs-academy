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
});
