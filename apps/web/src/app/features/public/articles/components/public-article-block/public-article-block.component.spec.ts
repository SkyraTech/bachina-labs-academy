import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { PublicArticleBlockComponent } from './public-article-block.component';
import { PublicArticleBlock } from '../../models/public-article.models';

describe('PublicArticleBlockComponent', () => {
  let component: PublicArticleBlockComponent;
  let componentRef: ComponentRef<PublicArticleBlockComponent>;
  let fixture: ComponentFixture<PublicArticleBlockComponent>;

  const createBlock = (
    type: PublicArticleBlock['type'],
    content: Record<string, unknown>,
    media: PublicArticleBlock['media'] = null,
  ): PublicArticleBlock => ({
    id: 'block-test-1',
    type,
    position: 0,
    schemaVersion: 1,
    content,
    media,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicArticleBlockComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicArticleBlockComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
  });

  it('should instantiate the component with external template and styles', () => {
    componentRef.setInput('block', createBlock('HEADING', { text: 'Test', level: 2 }));
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('HEADING block', () => {
    it('should render semantic h1..h4 with slugified id for anchors', () => {
      componentRef.setInput('block', createBlock('HEADING', { text: 'Architecture Overview', level: 2 }));
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const h2 = compiled.querySelector('h2');
      expect(h2).not.toBeNull();
      expect(h2?.textContent).toContain('Architecture Overview');
      expect(h2?.getAttribute('id')).toBe('architecture-overview');
    });

    it('should respect heading level 1, 3, and 4', () => {
      componentRef.setInput('block', createBlock('HEADING', { text: 'Title Level 1', level: 1 }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Title Level 1');

      componentRef.setInput('block', createBlock('HEADING', { text: 'Title Level 3', level: 3 }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h3')?.textContent).toContain('Title Level 3');

      componentRef.setInput('block', createBlock('HEADING', { text: 'Title Level 4', level: 4 }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h4')?.textContent).toContain('Title Level 4');
    });

    it('should generate Unicode-safe heading anchors for non-Latin scripts', () => {
      componentRef.setInput('block', createBlock('HEADING', { text: '日本語 Guide', level: 2 }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h2')?.getAttribute('id')).toBe('日本語-guide');

      componentRef.setInput('block', createBlock('HEADING', { text: 'परिचय Overview', level: 3 }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h3')?.getAttribute('id')).toBe('परिचय-overview');
    });

    it('should prioritize custom anchorId input when provided', () => {
      componentRef.setInput('block', createBlock('HEADING', { text: 'Architecture Overview', level: 2 }));
      componentRef.setInput('anchorId', 'custom-disambiguated-anchor-1');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h2')?.getAttribute('id')).toBe('custom-disambiguated-anchor-1');
    });
  });

  describe('RICH_TEXT block', () => {
    it('should render approved educational HTML formatting', () => {
      componentRef.setInput(
        'block',
        createBlock('RICH_TEXT', {
          html: '<p>This is <strong>bold</strong> and <em>italic</em>.</p>',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('strong')?.textContent).toBe('bold');
      expect(compiled.querySelector('em')?.textContent).toBe('italic');
    });

    it('should sanitize unsafe script payloads via Angular innerHTML binding', () => {
      componentRef.setInput(
        'block',
        createBlock('RICH_TEXT', {
          html: '<p>Safe text</p><script>alert("xss")</script>',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('script')).toBeNull();
      expect(compiled.textContent).toContain('Safe text');
    });
  });

  describe('IMAGE block', () => {
    it('should render image when media url is present', () => {
      componentRef.setInput(
        'block',
        createBlock(
          'IMAGE',
          { caption: 'Database Topology', altText: 'Replica setup' },
          {
            id: 'media-1',
            mimeType: 'image/webp',
            width: 800,
            height: 600,
            altText: 'Replica setup',
            url: 'https://cdn.example.com/postgres-topology.webp',
          },
        ),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const img = compiled.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('https://cdn.example.com/postgres-topology.webp');
      expect(compiled.querySelector('figcaption')?.textContent).toContain('Database Topology');
    });

    it('should render graceful placeholder when media url is null', () => {
      componentRef.setInput(
        'block',
        createBlock(
          'IMAGE',
          { caption: 'System Architecture Diagram', altText: 'Overview diagram' },
          {
            id: 'media-1',
            mimeType: 'image/webp',
            width: 800,
            height: 600,
            altText: 'Overview diagram',
            url: null,
          },
        ),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('img')).toBeNull();
      expect(compiled.textContent).toContain('System Architecture Diagram');
      expect(compiled.textContent).toContain('Overview diagram');
    });
  });

  describe('VIDEO block', () => {
    it('should render YOUTUBE provider with canonical badge and link', () => {
      componentRef.setInput(
        'block',
        createBlock('VIDEO', {
          provider: 'YOUTUBE',
          url: 'https://youtube.com/watch?v=12345',
          caption: 'Tutorial video',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('YOUTUBE VIDEO');
      expect(compiled.textContent).toContain('Watch on YouTube');
      const link = compiled.querySelector('a');
      expect(link?.getAttribute('href')).toBe('https://youtube.com/watch?v=12345');
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(compiled.textContent).toContain('Tutorial video');
    });

    it('should render VIMEO provider with canonical badge and link', () => {
      componentRef.setInput(
        'block',
        createBlock('VIDEO', {
          provider: 'VIMEO',
          url: 'https://vimeo.com/12345678',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('VIMEO VIDEO');
      expect(compiled.textContent).toContain('Watch on Vimeo');
    });

    it('should render CUSTOM provider with canonical badge and link', () => {
      componentRef.setInput(
        'block',
        createBlock('VIDEO', {
          provider: 'CUSTOM',
          url: 'https://video.example.com/stream.mp4',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('CUSTOM VIDEO');
      expect(compiled.textContent).toContain('Watch on Custom');
    });

    it('should fallback unknown provider values to CUSTOM safely', () => {
      componentRef.setInput(
        'block',
        createBlock('VIDEO', {
          provider: 'LOOM',
          url: 'https://loom.com/share/12345',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('CUSTOM VIDEO');
    });

    it('should disable unsafe protocols like javascript: in video url', () => {
      componentRef.setInput(
        'block',
        createBlock('VIDEO', {
          provider: 'CUSTOM',
          url: 'javascript:alert(1)',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('a')).toBeNull();
      expect(compiled.textContent).toContain('External video link unavailable');
    });
  });

  describe('CODE block', () => {
    it('should render code as literal text preserving formatting and whitespace', () => {
      const codeSnippet = 'SELECT * FROM users\nWHERE active = true;';
      componentRef.setInput(
        'block',
        createBlock('CODE', {
          code: codeSnippet,
          language: 'sql',
          showLineNumbers: true,
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('pre')?.textContent).toContain('SELECT * FROM users');
      expect(compiled.textContent).toContain('SQL');
      expect(compiled.textContent).toContain('Numbered');
    });

    it('should strictly escape HTML in code blocks without executing it', () => {
      componentRef.setInput(
        'block',
        createBlock('CODE', {
          code: '<script>alert("not-executed")</script>',
          language: 'html',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('script')).toBeNull();
      expect(compiled.querySelector('code')?.textContent).toBe('<script>alert("not-executed")</script>');
    });
  });

  describe('QUOTE block', () => {
    it('should render semantic blockquote and author attribution', () => {
      componentRef.setInput(
        'block',
        createBlock('QUOTE', {
          quote: 'Premature optimization is the root of all evil.',
          author: 'Donald Knuth',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const bq = compiled.querySelector('blockquote');
      expect(bq).not.toBeNull();
      expect(bq?.textContent).toContain('Premature optimization is the root of all evil.');
      expect(compiled.querySelector('cite')?.textContent).toContain('Donald Knuth');
    });
  });

  describe('CALLOUT block', () => {
    it('should render callout with title, body, and variant styling', () => {
      componentRef.setInput(
        'block',
        createBlock('CALLOUT', {
          variant: 'WARNING',
          title: 'Database Migration Notice',
          body: 'Ensure full backups before applying schema updates.',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Database Migration Notice');
      expect(compiled.textContent).toContain('Ensure full backups before applying schema updates.');
      expect(compiled.querySelector('.callout-warning')).not.toBeNull();
    });

    it('should support TIP, NOTE, and INFO variants', () => {
      componentRef.setInput(
        'block',
        createBlock('CALLOUT', { variant: 'TIP', body: 'Tip content' }),
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.callout-tip')).not.toBeNull();

      componentRef.setInput(
        'block',
        createBlock('CALLOUT', { variant: 'NOTE', body: 'Note content' }),
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.callout-note')).not.toBeNull();

      componentRef.setInput(
        'block',
        createBlock('CALLOUT', { variant: 'INFO', body: 'Info content' }),
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.callout-info')).not.toBeNull();
    });
  });

  describe('TABLE block', () => {
    it('should render semantic thead, tbody, th, and td elements', () => {
      componentRef.setInput(
        'block',
        createBlock('TABLE', {
          headers: ['Metric', 'Baseline', 'Target'],
          rows: [
            ['P99 Latency', '120ms', '< 25ms'],
            ['Throughput', '5,000 rps', '25,000 rps'],
          ],
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const ths = compiled.querySelectorAll('th');
      expect(ths.length).toBe(3);
      expect(ths[0].textContent?.trim()).toBe('Metric');

      const trs = compiled.querySelectorAll('tbody tr');
      expect(trs.length).toBe(2);
      expect(trs[0].textContent).toContain('P99 Latency');
      expect(trs[0].textContent).toContain('120ms');
    });
  });

  describe('DIVIDER block', () => {
    it('should render semantic hr divider', () => {
      componentRef.setInput('block', createBlock('DIVIDER', {}));
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('hr')).not.toBeNull();
    });
  });

  describe('LINK_CARD block', () => {
    it('should render safe external link with noopener noreferrer', () => {
      componentRef.setInput(
        'block',
        createBlock('LINK_CARD', {
          title: 'PostgreSQL Documentation',
          description: 'Official reference manual for version 17',
          url: 'https://www.postgresql.org/docs/17/',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const link = compiled.querySelector('a');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe('https://www.postgresql.org/docs/17/');
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(compiled.textContent).toContain('PostgreSQL Documentation');
      expect(compiled.textContent).toContain('Official reference manual for version 17');
    });

    it('should disable unsafe protocols in link card', () => {
      componentRef.setInput(
        'block',
        createBlock('LINK_CARD', {
          title: 'Malicious Link',
          url: 'javascript:alert(1)',
        }),
      );
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('a')).toBeNull();
      expect(compiled.textContent).toContain('Link card destination unavailable');
    });
  });
});
