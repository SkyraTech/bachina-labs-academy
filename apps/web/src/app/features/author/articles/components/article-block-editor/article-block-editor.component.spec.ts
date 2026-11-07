import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticleBlockEditorComponent } from './article-block-editor.component';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleBlock } from '../../models/article.models';

import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { MediaAssetDto } from '../../models/article-media.models';

describe('ArticleBlockEditorComponent', () => {
  let component: ArticleBlockEditorComponent;
  let fixture: ComponentFixture<ArticleBlockEditorComponent>;
  let selectedBlockSignal: WritableSignal<ArticleBlock | null>;
  let stateMock: {
    selectedBlock: WritableSignal<ArticleBlock | null>;
    isSaving: ReturnType<typeof vi.fn>;
    markDirty: ReturnType<typeof vi.fn>;
    updateBlock: ReturnType<typeof vi.fn>;
  };
  let mediaApiMock: {
    getPrivateMediaPreviewUrl: ReturnType<typeof vi.fn>;
    listMyMedia: ReturnType<typeof vi.fn>;
  };

  const sampleHeadingBlock: ArticleBlock = {
    id: 'b-1',
    articleId: 'art-1',
    type: 'HEADING',
    position: 0,
    content: { text: 'Initial Heading', level: 2 },
    mediaAssetId: null,
    schemaVersion: 1,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
  };

  beforeEach(async () => {
    selectedBlockSignal = signal<ArticleBlock | null>(sampleHeadingBlock);
    stateMock = {
      selectedBlock: selectedBlockSignal,
      isSaving: vi.fn().mockReturnValue(false),
      markDirty: vi.fn(),
      updateBlock: vi.fn().mockResolvedValue(true),
    };

    mediaApiMock = {
      getPrivateMediaPreviewUrl: vi.fn((id: string) => `/api/v1/articles/media/${id}/content`),
      listMyMedia: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleBlockEditorComponent],
      providers: [
        { provide: ArticleEditorStateService, useValue: stateMock },
        { provide: ArticleMediaApiService, useValue: mediaApiMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleBlockEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should populate buffer from selected block', () => {
    expect(component.headingText).toBe('Initial Heading');
    expect(component.headingLevel).toBe(2);
    expect(component.isDirty()).toBe(false);
  });

  it('2. should mark dirty when fields change', () => {
    component.headingText = 'Updated Heading Text';
    component.markDirty();

    expect(component.isDirty()).toBe(true);
    expect(stateMock.markDirty).toHaveBeenCalled();
  });

  it('3. should validate required fields according to block type rules', () => {
    component.headingText = 'Valid Heading';
    expect(component.isValid()).toBe(true);

    component.headingText = '   ';
    expect(component.isValid()).toBe(false);
  });

  describe('HEADING boundary tests', () => {
    it('should reject empty or whitespace-only heading', () => {
      component.headingText = '';
      expect(component.isValid()).toBe(false);

      component.headingText = '   \t  ';
      expect(component.isValid()).toBe(false);
    });

    it('should accept 1-character heading', () => {
      component.headingText = 'A';
      expect(component.isValid()).toBe(true);
    });

    it('should accept 255-character heading', () => {
      component.headingText = 'H'.repeat(255);
      expect(component.isValid()).toBe(true);
    });

    it('should accept 256-character heading', () => {
      component.headingText = 'H'.repeat(256);
      expect(component.isValid()).toBe(true);
    });

    it('should accept 500-character heading', () => {
      component.headingText = 'H'.repeat(500);
      expect(component.isValid()).toBe(true);
    });

    it('should reject 501-character heading', () => {
      component.headingText = 'H'.repeat(501);
      expect(component.isValid()).toBe(false);
    });
  });

  describe('RICH_TEXT formatting & contract tests', () => {
    beforeEach(() => {
      const richBlock: ArticleBlock = {
        id: 'b-rich',
        articleId: 'art-1',
        type: 'RICH_TEXT',
        position: 0,
        content: { html: '<p>Initial text</p>' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      };
      selectedBlockSignal.set(richBlock);
      TestBed.flushEffects();
    });

    it('should emit <strong> for bold and <em> for italic', () => {
      component.richTextHtml = '';
      component.wrapHtml('<strong>', '</strong>');
      expect(component.richTextHtml).toBe('<strong>text</strong>');

      component.richTextHtml = '';
      component.wrapHtml('<em>', '</em>');
      expect(component.richTextHtml).toBe('<em>text</em>');
    });

    it('should normalize legacy <b> and <i> tags to <strong> and <em>', () => {
      const raw = '<p><b>Bold text</b> and <i>italic text</i></p>';
      const normalized = component.normalizeHtml(raw);

      expect(normalized).toBe('<p><strong>Bold text</strong> and <em>italic text</em></p>');
      expect(normalized).not.toContain('<b>');
      expect(normalized).not.toContain('<i>');
    });

    it('should strip prohibited tags (script, style, iframe, form)', () => {
      const malicious = '<p>Hello <script>alert("XSS")</script><iframe src="evil.com"></iframe>world</p>';
      const cleaned = component.normalizeHtml(malicious);

      expect(cleaned).toBe('<p>Hello world</p>');
      expect(cleaned).not.toContain('<script>');
      expect(cleaned).not.toContain('<iframe>');
    });

    it('should strip prohibited attributes while retaining valid href and title on <a>', () => {
      const htmlWithAttrs = '<p class="banner" style="color:red"><a href="https://bachinalabs.com" title="Academy" onclick="hack()" class="link">Bachina Labs</a></p>';
      const cleaned = component.normalizeHtml(htmlWithAttrs);

      expect(cleaned).toBe('<p><a href="https://bachinalabs.com" title="Academy">Bachina Labs</a></p>');
      expect(cleaned).not.toContain('class=');
      expect(cleaned).not.toContain('style=');
      expect(cleaned).not.toContain('onclick=');
    });

    it('should normalize html payload when saving RICH_TEXT block', async () => {
      component.richTextHtml = '<p><b>Important</b> architecture note.</p>';
      component.markDirty();

      await component.onSave();

      expect(stateMock.updateBlock).toHaveBeenCalledWith(
        'b-rich',
        {
          html: '<p><strong>Important</strong> architecture note.</p>',
        },
        null,
      );
    });

    it('should handle paste events by extracting plain text and normalizing', () => {
      const pasteEvent = {
        preventDefault: vi.fn(),
        clipboardData: {
          getData: vi.fn().mockReturnValue('<p><b>Pasted bold</b></p>'),
        },
        target: {
          selectionStart: 0,
          selectionEnd: 0,
        },
      } as unknown as ClipboardEvent;

      component.richTextHtml = '';
      component.onPaste(pasteEvent);

      expect(pasteEvent.preventDefault).toHaveBeenCalled();
      expect(component.richTextHtml).toBe('<p><strong>Pasted bold</strong></p>');
      expect(component.isDirty()).toBe(true);
    });
  });

  describe('Contract Reconciliation Boundary Tests (QUOTE, CALLOUT, TABLE, LINK_CARD)', () => {
    it('QUOTE should accept up to 5,000 characters and reject 5,001', () => {
      const quoteBlock: ArticleBlock = {
        id: 'b-quote',
        articleId: 'art-1',
        type: 'QUOTE',
        position: 0,
        content: { quote: 'Short quote' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      };
      selectedBlockSignal.set(quoteBlock);
      TestBed.flushEffects();

      component.quoteText = 'Q'.repeat(5000);
      expect(component.isValid()).toBe(true);

      component.quoteText = 'Q'.repeat(5001);
      expect(component.isValid()).toBe(false);
    });

    it('CALLOUT should accept up to 5,000 characters and reject 5,001', () => {
      const calloutBlock: ArticleBlock = {
        id: 'b-callout',
        articleId: 'art-1',
        type: 'CALLOUT',
        position: 0,
        content: { variant: 'INFO', body: 'Callout body' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      };
      selectedBlockSignal.set(calloutBlock);
      TestBed.flushEffects();

      component.calloutBody = 'C'.repeat(5000);
      expect(component.isValid()).toBe(true);

      component.calloutBody = 'C'.repeat(5001);
      expect(component.isValid()).toBe(false);
    });

    it('TABLE should accept headers up to 255 chars and cells up to 1,000 chars', () => {
      const tableBlock: ArticleBlock = {
        id: 'b-table',
        articleId: 'art-1',
        type: 'TABLE',
        position: 0,
        content: { headers: ['Header 1'], rows: [['Cell 1']] },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      };
      selectedBlockSignal.set(tableBlock);
      TestBed.flushEffects();

      component.tableHeaders = ['H'.repeat(255)];
      component.tableRows = [['C'.repeat(1000)]];
      expect(component.isValid()).toBe(true);

      // Header > 255
      component.tableHeaders = ['H'.repeat(256)];
      expect(component.isValid()).toBe(false);

      // Cell > 1000
      component.tableHeaders = ['H'.repeat(255)];
      component.tableRows = [['C'.repeat(1001)]];
      expect(component.isValid()).toBe(false);
    });

    it('LINK_CARD should accept description up to 1,000 chars and reject 1,001', () => {
      const linkBlock: ArticleBlock = {
        id: 'b-link',
        articleId: 'art-1',
        type: 'LINK_CARD',
        position: 0,
        content: { url: 'https://bachinalabs.com', title: 'Bachina Labs' },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      };
      selectedBlockSignal.set(linkBlock);
      TestBed.flushEffects();

      component.linkUrl = 'https://bachinalabs.com';
      component.linkTitle = 'Bachina Labs';
      component.linkDescription = 'D'.repeat(1000);
      expect(component.isValid()).toBe(true);

      component.linkDescription = 'D'.repeat(1001);
      expect(component.isValid()).toBe(false);
    });
  });

  it('4. should save valid block content and reset dirty state', async () => {
    component.headingText = 'Confirmed Save';
    component.headingLevel = 3;
    component.markDirty();

    await component.onSave();

    expect(stateMock.updateBlock).toHaveBeenCalledWith(
      'b-1',
      {
        text: 'Confirmed Save',
        level: 3,
      },
      null,
    );
    expect(component.isDirty()).toBe(false);
  });

  it('5. should support TABLE column and row additions', () => {
    const tableBlock: ArticleBlock = {
      id: 'b-table',
      articleId: 'art-1',
      type: 'TABLE',
      position: 1,
      content: { headers: ['Col 1'], rows: [['Val 1']] },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-25T10:00:00Z',
    };
    selectedBlockSignal.set(tableBlock);
    TestBed.flushEffects();

    component.addTableColumn();
    expect(component.tableHeaders.length).toBe(2);
    expect(component.tableRows[0].length).toBe(2);

    component.addTableRow();
    expect(component.tableRows.length).toBe(2);
    expect(component.isDirty()).toBe(true);
  });

  it('6. should reset buffer on cancel', () => {
    component.headingText = 'Modified but will cancel';
    component.markDirty();

    component.onCancel();

    expect(component.headingText).toBe('Initial Heading');
    expect(component.isDirty()).toBe(false);
  });

  it('7. should handle IMAGE block media selection and save mediaAssetId', async () => {
    const imageBlock: ArticleBlock = {
      id: 'b-img',
      articleId: 'art-1',
      type: 'IMAGE',
      position: 2,
      content: { caption: 'Figure 1', altText: 'Diagram' },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-25T10:00:00Z',
    };
    selectedBlockSignal.set(imageBlock);
    TestBed.flushEffects();

    expect(component.imageCaption).toBe('Figure 1');
    expect(component.imageAltText).toBe('Diagram');
    expect(component.imageMediaId()).toBeNull();

    const selectedAsset: MediaAssetDto = {
      id: 'media-img-888',
      originalFilename: 'architecture.png',
      mimeType: 'image/png',
      fileSize: 2048,
      mediaType: 'IMAGE',
      width: null,
      height: null,
      createdAt: '2026-10-26T00:00:00Z',
    };

    component.onImageSelected(selectedAsset);
    expect(component.imageMediaId()).toBe('media-img-888');
    expect(component.isPickerOpen()).toBe(false);
    expect(component.isDirty()).toBe(true);

    await component.onSave();

    expect(stateMock.updateBlock).toHaveBeenCalledWith(
      'b-img',
      {
        caption: 'Figure 1',
        altText: 'Diagram',
      },
      'media-img-888',
    );
    expect(component.isDirty()).toBe(false);
  });

  describe('RICH_TEXT visual editor integration', () => {
    const sampleRichBlock: ArticleBlock = {
      id: 'b-rich-1',
      articleId: 'art-1',
      type: 'RICH_TEXT',
      position: 1,
      content: { html: '<p>Initial rich text</p>' },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-25T10:00:00Z',
    };

    beforeEach(() => {
      selectedBlockSignal.set(sampleRichBlock);
      TestBed.flushEffects();
    });

    it('should receive content changes from visual editor', () => {
      component.onRichTextContentChange('<p><strong>Formatted</strong> content</p>');
      expect(component.richTextHtml).toBe('<p><strong>Formatted</strong> content</p>');
    });

    it('should mark dirty when visual editor emits isDirty', () => {
      component.onRichTextDirtyChange(true);
      expect(component.isDirty()).toBe(true);
      expect(stateMock.markDirty).toHaveBeenCalled();
    });

    it('should block save when source is invalid', async () => {
      component.onRichTextContentChange('<p class="invalid">Bad HTML</p>');
      component.onRichTextSourceValidChange(false);
      expect(component.isValid()).toBe(false);

      await component.onSave();
      expect(stateMock.updateBlock).not.toHaveBeenCalled();
    });

    it('should save clean normalized HTML when valid', async () => {
      component.onRichTextContentChange('<p><strong>Clean</strong></p>');
      component.onRichTextSourceValidChange(true);
      expect(component.isValid()).toBe(true);

      await component.onSave();
      expect(stateMock.updateBlock).toHaveBeenCalledWith(
        'b-rich-1',
        { html: '<p><strong>Clean</strong></p>' },
        null,
      );
    });

    it('should reset isSourceValid on cancel', () => {
      component.onRichTextSourceValidChange(false);
      component.onCancel();
      expect(component.isSourceValid()).toBe(true);
    });
  });
});
