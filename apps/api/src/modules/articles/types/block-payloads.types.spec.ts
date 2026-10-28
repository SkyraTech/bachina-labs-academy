import { describe, it, expect, beforeAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ArticleBlockType } from '@prisma/client';
import {
  validateBlockContent,
  isValidHttpUrl,
  decodeHtmlEntities,
} from './block-payloads.types.js';

describe('Block Content Validators (validateBlockContent)', () => {
  describe('General JSON and size constraints', () => {
    it('rejects null or non-object content', () => {
      expect(() => validateBlockContent(ArticleBlockType.HEADING, null)).toThrow(
        BadRequestException,
      );
      expect(() => validateBlockContent(ArticleBlockType.HEADING, 'not an object')).toThrow(
        BadRequestException,
      );
      expect(() => validateBlockContent(ArticleBlockType.HEADING, 123)).toThrow(
        BadRequestException,
      );
      expect(() => validateBlockContent(ArticleBlockType.HEADING, [1, 2, 3])).toThrow(
        BadRequestException,
      );
    });

    it('rejects content exceeding 65000 bytes limit', () => {
      const hugeText = 'a'.repeat(66000);
      expect(() =>
        validateBlockContent(ArticleBlockType.CODE, { code: hugeText }),
      ).toThrow('Block content exceeds maximum allowed size of 65536 bytes');
    });

    it('accepts content within the 65000 bytes application boundary', () => {
      const boundaryText = 'a'.repeat(59000);
      const res = validateBlockContent(ArticleBlockType.CODE, { code: boundaryText });
      expect(res.code).toHaveLength(59000);
    });
  });

  describe('HEADING validation', () => {
    it('accepts valid heading with level 1, 2, 3, 4', () => {
      for (const level of [1, 2, 3, 4] as const) {
        const res = validateBlockContent(ArticleBlockType.HEADING, {
          text: 'Title Heading',
          level,
        });
        expect(res).toEqual({ text: 'Title Heading', level });
      }
    });

    it('rejects empty, missing, or oversized text', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.HEADING, { text: '', level: 2 }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateBlockContent(ArticleBlockType.HEADING, { text: '   ', level: 2 }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateBlockContent(ArticleBlockType.HEADING, { level: 2 }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateBlockContent(ArticleBlockType.HEADING, {
          text: 'x'.repeat(501),
          level: 2,
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects invalid levels', () => {
      for (const level of [0, 5, -1, 2.5, '2']) {
        expect(() =>
          validateBlockContent(ArticleBlockType.HEADING, {
            text: 'Valid',
            level,
          }),
        ).toThrow(BadRequestException);
      }
    });
  });

  describe('RICH_TEXT: Adversarial Security & Content Matrix', () => {
    describe('A. Direct script execution attempts', () => {
      it('rejects <script> tags in standard, mixed, and uppercase forms', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p>Hello</p><script>alert("XSS")</script>',
          }),
        ).toThrow('Prohibited HTML element: <script>.');

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p>Hello</p><ScRiPt>alert("XSS")</ScRiPt>',
          }),
        ).toThrow('Prohibited HTML element: <script>.');

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<SCRIPT SRC="https://evil.com/xss.js"></SCRIPT>',
          }),
        ).toThrow('Prohibited HTML element: <script>.');
      });

      it('rejects inline event handlers on any element', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p onclick="alert(1)">Click me</p>',
          }),
        ).toThrow(/Event handler attribute "onclick" is prohibited/);

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<strong onmouseover="alert(1)">Hover</strong>',
          }),
        ).toThrow(/Event handler attribute "onmouseover" is prohibited/);
      });

      it('rejects javascript: pseudo-protocol links', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="javascript:alert(1)">Click</a>',
          }),
        ).toThrow(/Prohibited link protocol "javascript:"/);

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="JAVASCRIPT:alert(1)">Click</a>',
          }),
        ).toThrow(/Prohibited link protocol "javascript:"/);
      });

      it('rejects dangerous embedded elements (object, embed, iframe)', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<iframe src="https://evil.example.com"></iframe>',
          }),
        ).toThrow('Prohibited HTML element: <iframe>.');

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<object data="exploit.swf"></object>',
          }),
        ).toThrow('Prohibited HTML element: <object>.');

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<embed src="exploit.pdf" />',
          }),
        ).toThrow('Prohibited HTML element: <embed>.');
      });
    });

    describe('B. Encoding and normalization', () => {
      it('decodes HTML entities correctly before evaluation', () => {
        expect(decodeHtmlEntities('&lt;b&gt;Test&lt;/b&gt;')).toBe('<b>Test</b>');
        expect(decodeHtmlEntities('&#x6a;&#x61;&#x76;&#x61;')).toBe('java');
        expect(decodeHtmlEntities('&#106;&#97;&#118;&#97;')).toBe('java');
        expect(decodeHtmlEntities('&quotHello&quot')).toBe('"Hello"');
        expect(decodeHtmlEntities('&#106;avascript:alert(1)')).toBe('javascript:alert(1)');
      });

      it('rejects entity-encoded javascript: links', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="jav&#x09;ascript:alert(1)">Click</a>',
          }),
        ).toThrow();

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;:alert(1)">Click</a>',
          }),
        ).toThrow(/Prohibited link protocol "javascript:"/);
      });

      it('rejects control characters in HTML content', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p>Invalid \x00 null byte</p>',
          }),
        ).toThrow('RICH_TEXT content contains invalid control characters.');

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p>Invalid \x08 backspace</p>',
          }),
        ).toThrow('RICH_TEXT content contains invalid control characters.');
      });
    });

    describe('C. Malformed and nested markup', () => {
      it('rejects unclosed HTML elements', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p>Unclosed paragraph',
          }),
        ).toThrow('Unclosed HTML elements: <p> was not closed.');

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p><strong>Unclosed bold</p>',
          }),
        ).toThrow(/Misnested HTML closing tag/);
      });

      it('rejects misnested elements', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p><em><strong>Cross-nested</em></strong></p>',
          }),
        ).toThrow(/Misnested HTML closing tag/);
      });

      it('rejects SVG and MathML payloads', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<svg><script>alert(1)</script></svg>',
          }),
        ).toThrow('Prohibited HTML element: <svg>.');

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<math><mi>x</mi></math>',
          }),
        ).toThrow('Prohibited HTML element: <math>.');
      });

      it('rejects untrusted custom elements', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<x-custom-widget>Payload</x-custom-widget>',
          }),
        ).toThrow('Prohibited HTML element: <x-custom-widget>.');
      });

      it('rejects unclosed comments', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p>Hello <!-- unclosed comment</p>',
          }),
        ).toThrow(/unclosed HTML comment/i);
      });
    });

    describe('D. Browser navigation and embedding', () => {
      it('rejects data: links', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="data:text/html,<script>alert(1)</script>">Link</a>',
          }),
        ).toThrow(/Prohibited link protocol "data:"/);
      });

      it('rejects vbscript: links', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="vbscript:msgbox(1)">Link</a>',
          }),
        ).toThrow(/Prohibited link protocol "vbscript:"/);
      });

      it('rejects file: links', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="file:///etc/passwd">Link</a>',
          }),
        ).toThrow(/Prohibited link protocol "file:"/);
      });

      it('rejects blob: links', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="blob:https://example.com/uuid">Link</a>',
          }),
        ).toThrow(/Prohibited link protocol "blob:"/);
      });

      it('rejects protocol-relative URLs', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="//evil.example.com">Link</a>',
          }),
        ).toThrow(/valid absolute HTTP or HTTPS URL/);
      });
    });

    describe('E. DOM and attribute safety', () => {
      it('rejects id and name attributes that could cause DOM clobbering', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a id="window" href="https://example.com">Link</a>',
          }),
        ).toThrow(/Prohibited attribute "id" on <a> element/);

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a name="submit" href="https://example.com">Link</a>',
          }),
        ).toThrow(/Prohibited attribute "name" on <a> element/);
      });

      it('rejects arbitrary style attributes and CSS injection', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<p style="color:red; background:url(javascript:alert(1))">Text</p>',
          }),
        ).toThrow(/Attributes are not permitted on <p>/);

        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a style="display:block" href="https://example.com">Link</a>',
          }),
        ).toThrow(/Prohibited attribute "style" on <a> element/);
      });

      it('rejects duplicate attributes on any element', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<a href="https://example.com" href="https://evil.com">Link</a>',
          }),
        ).toThrow(/Duplicate attribute "href"/);
      });

      it('rejects form elements and buttons', () => {
        expect(() =>
          validateBlockContent(ArticleBlockType.RICH_TEXT, {
            html: '<form action="https://evil.com"><input type="text" /><button>Submit</button></form>',
          }),
        ).toThrow('Prohibited HTML element: <form>.');
      });
    });

    describe('F. Safe educational examples', () => {
      it('accepts valid paragraphs with formatting tags', () => {
        const input = '<p>A paragraph with <strong>bold</strong>, <em>italic</em>, <u>underline</u>, and <s>strikethrough</s>.</p>';
        const res = validateBlockContent(ArticleBlockType.RICH_TEXT, { html: input });
        expect(res).toEqual({ html: input });
      });

      it('accepts ordered and unordered lists', () => {
        const input = '<ul><li>Item 1</li><li>Item 2</li></ul><ol><li>First</li><li>Second</li></ol>';
        const res = validateBlockContent(ArticleBlockType.RICH_TEXT, { html: input });
        expect(res).toEqual({ html: input });
      });

      it('accepts blockquotes, code, pre, sub, and sup elements', () => {
        const input = '<blockquote><p>Quote here</p></blockquote><pre><code>console.log("hello");</code></pre><p>H<sub>2</sub>O and E=mc<sup>2</sup></p>';
        const res = validateBlockContent(ArticleBlockType.RICH_TEXT, { html: input });
        expect(res).toEqual({ html: input });
      });

      it('accepts safe external HTTPS links with title', () => {
        const input = '<p>Visit <a href="https://bachinalabs.com/docs" title="Documentation">Bachina Labs</a> for details.</p>';
        const res = validateBlockContent(ArticleBlockType.RICH_TEXT, { html: input });
        expect(res).toEqual({ html: input });
      });

      it('accepts self-closing <br> and normalizes void tags', () => {
        const input = '<p>First line<br/>Second line<br>Third line</p>';
        const res = validateBlockContent(ArticleBlockType.RICH_TEXT, { html: input });
        expect(res.html).toBe('<p>First line<br>Second line<br>Third line</p>');
      });

      it('safely escapes naked less-than characters that are not HTML tags', () => {
        const input = '<p>Math: 5 < 10 and 10 > 5.</p>';
        const res = validateBlockContent(ArticleBlockType.RICH_TEXT, { html: input });
        expect(res.html).toBe('<p>Math: 5 &lt; 10 and 10 > 5.</p>');
      });
    });
  });

  describe('IMAGE validation', () => {
    it('accepts valid optional caption and altText', () => {
      const res = validateBlockContent(ArticleBlockType.IMAGE, {
        caption: 'Architecture Diagram',
        altText: 'Shows service relationships',
      });
      expect(res).toEqual({
        caption: 'Architecture Diagram',
        altText: 'Shows service relationships',
      });
    });

    it('accepts empty object for IMAGE content', () => {
      const res = validateBlockContent(ArticleBlockType.IMAGE, {});
      expect(res).toEqual({});
    });

    it('rejects caption over 500 characters or altText over 255 characters', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.IMAGE, {
          caption: 'c'.repeat(501),
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateBlockContent(ArticleBlockType.IMAGE, {
          altText: 'a'.repeat(256),
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('VIDEO: URL Security & Hostname Spoofing Protection', () => {
    it('accepts valid YouTube video URLs across approved hosts', () => {
      const validUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com/watch?v=dQw4w9WgXcQ',
        'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        'https://www.youtu.be/dQw4w9WgXcQ',
      ];

      for (const url of validUrls) {
        const res = validateBlockContent(ArticleBlockType.VIDEO, {
          provider: 'YOUTUBE',
          url,
          caption: 'Test',
        });
        expect(res.url).toBe(url);
      }
    });

    it('rejects deceptive YouTube hostname spoofing attempts', () => {
      const spoofedUrls = [
        'https://youtube.com.attacker.example/watch?v=123',
        'https://notyoutube.com/watch?v=123',
        'https://attacker.example/youtube.com',
        'https://fake-youtube.com/video',
        'https://www.youtube.com.phishing.io/watch',
      ];

      for (const url of spoofedUrls) {
        expect(() =>
          validateBlockContent(ArticleBlockType.VIDEO, {
            provider: 'YOUTUBE',
            url,
          }),
        ).toThrow('Invalid host');
      }
    });

    it('accepts valid Vimeo video URLs across approved hosts', () => {
      const validUrls = [
        'https://vimeo.com/12345678',
        'https://www.vimeo.com/12345678',
        'https://player.vimeo.com/video/12345678',
      ];

      for (const url of validUrls) {
        const res = validateBlockContent(ArticleBlockType.VIDEO, {
          provider: 'VIMEO',
          url,
        });
        expect(res.url).toBe(url);
      }
    });

    it('rejects deceptive Vimeo hostname spoofing attempts', () => {
      const spoofedUrls = [
        'https://vimeo.com.attacker.example/12345678',
        'https://notvimeo.com/12345678',
        'https://attacker.example/vimeo.com',
      ];

      for (const url of spoofedUrls) {
        expect(() =>
          validateBlockContent(ArticleBlockType.VIDEO, {
            provider: 'VIMEO',
            url,
          }),
        ).toThrow('Invalid host');
      }
    });

    it('rejects embedded credentials in VIDEO URLs', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.VIDEO, {
          provider: 'YOUTUBE',
          url: 'https://admin:secret@www.youtube.com/watch?v=123',
        }),
      ).toThrow('cannot contain embedded credentials');
    });

    it('rejects dangerous or non-http protocols in VIDEO URLs', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.VIDEO, {
          provider: 'CUSTOM',
          url: 'javascript:alert(1)',
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        validateBlockContent(ArticleBlockType.VIDEO, {
          provider: 'CUSTOM',
          url: 'data:video/mp4;base64,AAAA',
        }),
      ).toThrow(BadRequestException);
    });

    it('enforces HTTPS for CUSTOM video URLs', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.VIDEO, {
          provider: 'CUSTOM',
          url: 'http://cdn.example.com/video.mp4',
        }),
      ).toThrow(/CUSTOM video provider requires https protocol/);

      const res = validateBlockContent(ArticleBlockType.VIDEO, {
        provider: 'CUSTOM',
        url: 'https://cdn.example.com/video.mp4',
      });
      expect(res.url).toBe('https://cdn.example.com/video.mp4');
    });
  });

  describe('CODE validation', () => {
    it('accepts code block with language and showLineNumbers', () => {
      const res = validateBlockContent(ArticleBlockType.CODE, {
        code: 'const x = 42;\nconsole.log(x);',
        language: 'typescript',
        showLineNumbers: true,
      });
      expect(res).toEqual({
        code: 'const x = 42;\nconsole.log(x);',
        language: 'typescript',
        showLineNumbers: true,
      });
    });

    it('rejects missing or non-string code', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.CODE, {
          language: 'typescript',
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateBlockContent(ArticleBlockType.CODE, {
          code: 12345,
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('QUOTE validation', () => {
    it('accepts valid quote and author', () => {
      const res = validateBlockContent(ArticleBlockType.QUOTE, {
        quote: 'Simplicity is prerequisite for reliability.',
        author: 'Edsger W. Dijkstra',
      });
      expect(res).toEqual({
        quote: 'Simplicity is prerequisite for reliability.',
        author: 'Edsger W. Dijkstra',
      });
    });

    it('rejects empty quote', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.QUOTE, {
          quote: '',
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateBlockContent(ArticleBlockType.QUOTE, {
          quote: '   ',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('CALLOUT validation', () => {
    it('accepts valid callout variants', () => {
      for (const variant of ['INFO', 'WARNING', 'TIP', 'NOTE'] as const) {
        const res = validateBlockContent(ArticleBlockType.CALLOUT, {
          variant,
          title: 'Heads Up',
          body: 'This is important information.',
        });
        expect(res).toEqual({
          variant,
          title: 'Heads Up',
          body: 'This is important information.',
        });
      }
    });

    it('rejects invalid variant or empty body', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.CALLOUT, {
          variant: 'DANGER',
          body: 'Body text',
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        validateBlockContent(ArticleBlockType.CALLOUT, {
          variant: 'INFO',
          body: '',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('TABLE validation', () => {
    it('accepts valid table structure', () => {
      const res = validateBlockContent(ArticleBlockType.TABLE, {
        headers: ['Name', 'Role', 'Access'],
        rows: [
          ['Alice', 'Admin', 'Full'],
          ['Bob', 'Editor', 'Write'],
        ],
      });
      expect(res).toEqual({
        headers: ['Name', 'Role', 'Access'],
        rows: [
          ['Alice', 'Admin', 'Full'],
          ['Bob', 'Editor', 'Write'],
        ],
      });
    });

    it('rejects mismatched row cells', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.TABLE, {
          headers: ['A', 'B'],
          rows: [['Only one cell']],
        }),
      ).toThrow('Each TABLE row must match the number of headers.');
    });

    it('rejects empty headers', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.TABLE, {
          headers: [],
          rows: [],
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('DIVIDER validation', () => {
    it('accepts empty object for divider', () => {
      const res = validateBlockContent(ArticleBlockType.DIVIDER, {});
      expect(res).toEqual({});
    });
  });

  describe('LINK_CARD: URL Security & Validation', () => {
    it('accepts valid link card with https and http URLs', () => {
      const res = validateBlockContent(ArticleBlockType.LINK_CARD, {
        url: 'https://bachinalabs.com/academy',
        title: 'Bachina Labs Academy',
        description: 'Next-generation engineering curriculum.',
      });
      expect(res).toEqual({
        url: 'https://bachinalabs.com/academy',
        title: 'Bachina Labs Academy',
        description: 'Next-generation engineering curriculum.',
      });

      const resHttp = validateBlockContent(ArticleBlockType.LINK_CARD, {
        url: 'http://example.com/blog',
        title: 'Blog',
      });
      expect(resHttp.url).toBe('http://example.com/blog');
    });

    it('rejects embedded credentials in LINK_CARD URLs', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.LINK_CARD, {
          url: 'https://user:password@example.com/dashboard',
          title: 'Dashboard',
        }),
      ).toThrow('cannot contain embedded credentials');
    });

    it('rejects whitespace and control characters in LINK_CARD URLs', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.LINK_CARD, {
          url: 'https://example.com/path with spaces',
          title: 'Spaces',
        }),
      ).toThrow('contains invalid whitespace or control characters');
    });

    it('rejects dangerous protocols in LINK_CARD URLs', () => {
      const dangerousProtocols = [
        'javascript:alert(1)',
        'data:text/html,<h1>XSS</h1>',
        'file:///etc/hosts',
        'blob:https://example.com/xyz',
        'ftp://mirror.example.com/file',
      ];

      for (const url of dangerousProtocols) {
        expect(() =>
          validateBlockContent(ArticleBlockType.LINK_CARD, {
            url,
            title: 'Test',
          }),
        ).toThrow();
      }
    });

    it('rejects protocol-relative URLs', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.LINK_CARD, {
          url: '//evil.com/card',
          title: 'Protocol Relative',
        }),
      ).toThrow(/is not a valid absolute URL/);
    });

    it('rejects missing or empty title', () => {
      expect(() =>
        validateBlockContent(ArticleBlockType.LINK_CARD, {
          url: 'https://example.com',
          title: '',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('URL Protocol Validator (isValidHttpUrl)', () => {
    it('accepts http and https URLs', () => {
      expect(isValidHttpUrl('http://example.com')).toBe(true);
      expect(isValidHttpUrl('https://example.com/path?query=1')).toBe(true);
    });

    it('rejects dangerous or non-http URLs', () => {
      expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
      expect(isValidHttpUrl('data:text/html,<h1>XSS</h1>')).toBe(false);
      expect(isValidHttpUrl('file:///etc/passwd')).toBe(false);
      expect(isValidHttpUrl('ftp://example.com')).toBe(false);
      expect(isValidHttpUrl('not a url')).toBe(false);
      expect(isValidHttpUrl('https://user:pass@example.com')).toBe(false);
    });
  });

  describe('Independent Standards-Based HTML5 Verification (parse5 WHATWG Compliance)', () => {
    let parse5: any;

    beforeAll(async () => {
      try {
        const path = await import('path');
        const fs = await import('fs');
        // eslint-disable-next-line no-eval
        const req = (globalThis as any).require ?? eval('require');
        const candidates = [
          path.resolve('node_modules/.pnpm/parse5@8.0.1/node_modules/parse5'),
          path.resolve('../../node_modules/.pnpm/parse5@8.0.1/node_modules/parse5'),
          path.resolve('../node_modules/.pnpm/parse5@8.0.1/node_modules/parse5'),
        ];
        const p5Path = candidates.find((p) => fs.existsSync(p));
        if (p5Path) {
          parse5 = req(p5Path);
        }
      } catch (err) {
        console.warn('parse5 unavailable for independent test validation:', err);
      }
    });

    it('confirms every accepted canonical HTML snippet produces a valid WHATWG parse5 AST with only approved tags', () => {
      if (!parse5) return;

      const samples = [
        '<p>A paragraph with <strong>bold</strong> and <em>italic</em>.</p>',
        '<ul><li>Item 1</li><li>Item 2</li></ul>',
        '<ol><li>Ordered</li></ol>',
        '<blockquote><p>Quote</p></blockquote>',
        '<pre><code>console.log(1);</code></pre>',
        '<p>Water H<sub>2</sub>O and energy E=mc<sup>2</sup></p>',
        '<p>Visit <a href="https://bachinalabs.com/academy" title="Academy">Bachina Labs</a>.</p>',
        '<p>Line one<br>Line two</p>',
      ];

      const allowedTags = new Set([
        'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'sub', 'sup'
      ]);

      for (const sample of samples) {
        const validated = validateBlockContent(ArticleBlockType.RICH_TEXT, { html: sample });
        const fragment = parse5.parseFragment(validated.html);

        function walk(node: any) {
          if (node.nodeName !== '#text' && node.nodeName !== '#document-fragment') {
            expect(allowedTags.has(node.nodeName)).toBe(true);
            if (node.nodeName === 'a') {
              for (const attr of node.attrs) {
                expect(['href', 'title'].includes(attr.name)).toBe(true);
              }
            } else {
              expect(node.attrs.length).toBe(0);
            }
          }
          if (node.childNodes) {
            for (const child of node.childNodes) {
              walk(child);
            }
          }
        }

        walk(fragment);
      }
    });

    it('confirms standards-compliant parser serializes canonical HTML without mutating DOM structure', () => {
      if (!parse5) return;

      const input = '<p>Canonical structure with <a href="https://bachinalabs.com" title="Home">link</a> and <strong>bold</strong>.</p>';
      const validated = validateBlockContent(ArticleBlockType.RICH_TEXT, { html: input });
      const fragment = parse5.parseFragment(validated.html);
      const serialized = parse5.serialize(fragment);

      expect(serialized).toBe(validated.html);
    });
  });
});
