import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { ArticleBlock } from '../../models/article.models';
import { MediaAssetDto } from '../../models/article-media.models';
import { ArticleMediaPickerComponent } from '../article-media-picker/article-media-picker.component';

@Component({
  selector: 'app-article-block-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, ArticleMediaPickerComponent],
  templateUrl: './article-block-editor.component.html',
  styleUrl: './article-block-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleBlockEditorComponent {
  readonly state = inject(ArticleEditorStateService);
  private readonly mediaApi = inject(ArticleMediaApiService);
  readonly isDirty = signal(false);
  readonly imageMediaId = signal<string | null>(null);
  readonly isPickerOpen = signal(false);

  // Form buffers for each block type
  headingText = '';
  headingLevel = 2;

  richTextHtml = '';

  codeLanguage = '';
  codeShowLineNumbers = true;
  codeSnippet = '';

  quoteText = '';
  quoteAuthor = '';

  calloutVariant: 'INFO' | 'WARNING' | 'TIP' | 'NOTE' = 'INFO';
  calloutTitle = '';
  calloutBody = '';

  tableHeaders: string[] = ['Col 1', 'Col 2'];
  tableRows: string[][] = [['Val 1', 'Val 2']];

  linkUrl = '';
  linkTitle = '';
  linkDescription = '';

  videoProvider: 'YOUTUBE' | 'VIMEO' | 'CUSTOM' = 'YOUTUBE';
  videoUrl = '';
  videoCaption = '';

  imageCaption = '';
  imageAltText = '';

  constructor() {
    effect(() => {
      const block = this.state.selectedBlock();
      if (block) {
        this.populateBuffer(block);
        this.isDirty.set(false);
      }
    });
  }

  private populateBuffer(block: ArticleBlock): void {
    const c = block.content || {};
    switch (block.type) {
      case 'HEADING':
        this.headingText = typeof c['text'] === 'string' ? c['text'] : '';
        this.headingLevel = typeof c['level'] === 'number' ? c['level'] : 2;
        break;
      case 'RICH_TEXT':
        this.richTextHtml = typeof c['html'] === 'string' ? c['html'] : '';
        break;
      case 'CODE':
        this.codeLanguage = typeof c['language'] === 'string' ? c['language'] : '';
        this.codeShowLineNumbers = typeof c['showLineNumbers'] === 'boolean' ? c['showLineNumbers'] : true;
        this.codeSnippet = typeof c['code'] === 'string' ? c['code'] : '';
        break;
      case 'QUOTE':
        this.quoteText = typeof c['quote'] === 'string' ? c['quote'] : '';
        this.quoteAuthor = typeof c['author'] === 'string' ? c['author'] : '';
        break;
      case 'CALLOUT':
        this.calloutVariant = (c['variant'] as 'INFO' | 'WARNING' | 'TIP' | 'NOTE') || 'INFO';
        this.calloutTitle = typeof c['title'] === 'string' ? c['title'] : '';
        this.calloutBody = typeof c['body'] === 'string' ? c['body'] : '';
        break;
      case 'TABLE':
        this.tableHeaders = Array.isArray(c['headers']) ? [...(c['headers'] as string[])] : ['Col 1'];
        this.tableRows = Array.isArray(c['rows'])
          ? (c['rows'] as string[][]).map((r: string[]) => [...r])
          : [['Val 1']];
        break;
      case 'DIVIDER':
        break;
      case 'LINK_CARD':
        this.linkUrl = typeof c['url'] === 'string' ? c['url'] : '';
        this.linkTitle = typeof c['title'] === 'string' ? c['title'] : '';
        this.linkDescription = typeof c['description'] === 'string' ? c['description'] : '';
        break;
      case 'VIDEO':
        this.videoProvider = (c['provider'] as 'YOUTUBE' | 'VIMEO' | 'CUSTOM') || 'YOUTUBE';
        this.videoUrl = typeof c['url'] === 'string' ? c['url'] : '';
        this.videoCaption = typeof c['caption'] === 'string' ? c['caption'] : '';
        break;
      case 'IMAGE':
        this.imageCaption = typeof c['caption'] === 'string' ? c['caption'] : '';
        this.imageAltText = typeof c['altText'] === 'string' ? c['altText'] : '';
        this.imageMediaId.set(block.mediaAssetId || null);
        break;
    }
  }

  openMediaPicker(): void {
    this.isPickerOpen.set(true);
  }

  closeMediaPicker(): void {
    this.isPickerOpen.set(false);
  }

  onImageSelected(asset: MediaAssetDto): void {
    this.imageMediaId.set(asset.id);
    this.isPickerOpen.set(false);
    this.markDirty();
  }

  removeImage(): void {
    this.imageMediaId.set(null);
    this.markDirty();
  }

  getImagePreviewUrl(): string | null {
    const id = this.imageMediaId();
    return id ? this.mediaApi.getPrivateMediaPreviewUrl(id) : null;
  }

  markDirty(): void {
    this.isDirty.set(true);
    this.state.markDirty();
  }

  onCancel(): void {
    const block = this.state.selectedBlock();
    if (block) {
      this.populateBuffer(block);
      this.isDirty.set(false);
    }
  }

  isValid(): boolean {
    const block = this.state.selectedBlock();
    if (!block) return false;

    switch (block.type) {
      case 'HEADING':
        return (
          this.headingText.trim().length > 0 &&
          this.headingText.length <= 500 &&
          [1, 2, 3, 4].includes(this.headingLevel)
        );
      case 'RICH_TEXT':
        return (
          this.richTextHtml.trim().length > 0 &&
          this.richTextHtml.length <= 60000
        );
      case 'CODE':
        return (
          typeof this.codeSnippet === 'string' &&
          this.codeSnippet.length <= 60000 &&
          this.codeLanguage.length <= 50
        );
      case 'QUOTE':
        return (
          this.quoteText.trim().length > 0 &&
          this.quoteText.length <= 5000 &&
          this.quoteAuthor.length <= 255
        );
      case 'CALLOUT':
        return (
          this.calloutBody.trim().length > 0 &&
          this.calloutBody.length <= 5000 &&
          this.calloutTitle.length <= 255 &&
          ['INFO', 'WARNING', 'TIP', 'NOTE'].includes(this.calloutVariant)
        );
      case 'TABLE':
        return (
          this.tableHeaders.length > 0 &&
          this.tableHeaders.length <= 20 &&
          this.tableHeaders.every((h) => typeof h === 'string' && h.length <= 255) &&
          this.tableRows.length <= 100 &&
          this.tableRows.every(
            (row) =>
              row.length === this.tableHeaders.length &&
              row.every((cell) => typeof cell === 'string' && cell.length <= 1000),
          )
        );
      case 'DIVIDER':
        return true;
      case 'LINK_CARD':
        return (
          this.linkUrl.trim().length > 0 &&
          this.linkUrl.length <= 2000 &&
          this.linkTitle.trim().length > 0 &&
          this.linkTitle.length <= 255 &&
          this.linkDescription.length <= 1000
        );
      case 'VIDEO':
        return (
          this.videoUrl.trim().length > 0 &&
          this.videoUrl.length <= 2000 &&
          this.videoCaption.length <= 500 &&
          ['YOUTUBE', 'VIMEO', 'CUSTOM'].includes(this.videoProvider)
        );
      case 'IMAGE':
        return (
          this.imageCaption.length <= 500 &&
          this.imageAltText.length <= 255
        );
      default:
        return false;
    }
  }

  async onSave(): Promise<void> {
    const block = this.state.selectedBlock();
    if (!block || !this.isValid()) return;

    let payload: Record<string, unknown> = {};

    switch (block.type) {
      case 'HEADING':
        payload = { text: this.headingText.trim(), level: this.headingLevel };
        break;
      case 'RICH_TEXT':
        payload = { html: this.normalizeHtml(this.richTextHtml.trim()) };
        break;
      case 'CODE':
        payload = {
          code: this.codeSnippet,
          language: this.codeLanguage.trim() || undefined,
          showLineNumbers: this.codeShowLineNumbers,
        };
        break;
      case 'QUOTE':
        payload = {
          quote: this.quoteText.trim(),
          author: this.quoteAuthor.trim() || undefined,
        };
        break;
      case 'CALLOUT':
        payload = {
          variant: this.calloutVariant,
          title: this.calloutTitle.trim() || undefined,
          body: this.calloutBody.trim(),
        };
        break;
      case 'TABLE':
        payload = {
          headers: this.tableHeaders.map((h) => h.trim()),
          rows: this.tableRows.map((row) => row.map((cell) => cell.trim())),
        };
        break;
      case 'DIVIDER':
        payload = {};
        break;
      case 'LINK_CARD':
        payload = {
          url: this.linkUrl.trim(),
          title: this.linkTitle.trim(),
          description: this.linkDescription.trim() || undefined,
        };
        break;
      case 'VIDEO':
        payload = {
          provider: this.videoProvider,
          url: this.videoUrl.trim(),
          caption: this.videoCaption.trim() || undefined,
        };
        break;
      case 'IMAGE':
        payload = {
          caption: this.imageCaption.trim() || undefined,
          altText: this.imageAltText.trim() || undefined,
        };
        break;
    }

    const targetMediaAssetId = block.type === 'IMAGE' ? this.imageMediaId() : block.mediaAssetId;
    const success = await this.state.updateBlock(block.id, payload, targetMediaAssetId);
    if (success) {
      this.isDirty.set(false);
    }
  }

  normalizeHtml(raw: string): string {
    if (!raw) return '';
    return raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<b(\s+[^>]*)?>/gi, '<strong>')
      .replace(/<\/b>/gi, '</strong>')
      .replace(/<i(\s+[^>]*)?>/gi, '<em>')
      .replace(/<\/i>/gi, '</em>')
      .replace(/<\/?(script|style|iframe|svg|math|form|input|button|object|embed)(\s+[^>]*)?>/gi, '')
      .replace(/<([a-z0-9]+)([^>]*)>/gi, (_match, tag, attrs) => {
        const lowerTag = tag.toLowerCase();
        if (lowerTag === 'a') {
          const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
          const titleMatch = attrs.match(/\btitle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
          const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]) : '';
          const title = titleMatch ? (titleMatch[1] ?? titleMatch[2] ?? titleMatch[3]) : '';
          let result = '<a';
          if (href) result += ` href="${href}"`;
          if (title) result += ` title="${title}"`;
          result += '>';
          return result;
        } else if (lowerTag === 'br') {
          return '<br>';
        } else {
          return `<${lowerTag}>`;
        }
      });
  }

  wrapHtml(openTag: string, closeTag: string): void {
    const textarea = document.getElementById('rich-html') as HTMLTextAreaElement | null;
    if (textarea && textarea.selectionStart !== undefined && textarea.selectionEnd !== undefined) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = this.richTextHtml.substring(start, end);
      const replacement = selected.length > 0 ? `${openTag}${selected}${closeTag}` : `${openTag}text${closeTag}`;
      this.richTextHtml = this.richTextHtml.substring(0, start) + replacement + this.richTextHtml.substring(end);
      this.markDirty();
      setTimeout(() => {
        textarea.focus();
        const selStart = start + openTag.length;
        const selEnd = selStart + (selected.length || 4);
        textarea.setSelectionRange(selStart, selEnd);
      }, 0);
    } else {
      this.richTextHtml += `${openTag}text${closeTag}`;
      this.markDirty();
    }
  }

  insertHtml(snippet: string): void {
    const textarea = document.getElementById('rich-html') as HTMLTextAreaElement | null;
    if (textarea && textarea.selectionStart !== undefined) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      this.richTextHtml = this.richTextHtml.substring(0, start) + snippet + this.richTextHtml.substring(end);
      this.markDirty();
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + snippet.length, start + snippet.length);
      }, 0);
    } else {
      this.richTextHtml += snippet;
      this.markDirty();
    }
  }

  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    const text = clipboardData.getData('text/plain') || '';
    const normalized = this.normalizeHtml(text);
    const textarea = event.target as HTMLTextAreaElement;
    const start = textarea.selectionStart ?? this.richTextHtml.length;
    const end = textarea.selectionEnd ?? this.richTextHtml.length;
    this.richTextHtml = this.richTextHtml.substring(0, start) + normalized + this.richTextHtml.substring(end);
    this.markDirty();
  }

  // Table manipulation methods
  addTableColumn(): void {
    if (this.tableHeaders.length >= 20) return;
    this.tableHeaders.push(`Col ${this.tableHeaders.length + 1}`);
    for (const row of this.tableRows) {
      row.push('');
    }
    this.markDirty();
  }

  removeTableColumn(colIdx: number): void {
    if (this.tableHeaders.length <= 1) return;
    this.tableHeaders.splice(colIdx, 1);
    for (const row of this.tableRows) {
      row.splice(colIdx, 1);
    }
    this.markDirty();
  }

  addTableRow(): void {
    if (this.tableRows.length >= 100) return;
    const newRow = new Array(this.tableHeaders.length).fill('');
    this.tableRows.push(newRow);
    this.markDirty();
  }

  removeTableRow(rowIdx: number): void {
    if (this.tableRows.length <= 1) return;
    this.tableRows.splice(rowIdx, 1);
    this.markDirty();
  }

  updateHeader(colIdx: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.tableHeaders[colIdx] = val;
    this.markDirty();
  }

  updateCell(rowIdx: number, colIdx: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.tableRows[rowIdx][colIdx] = val;
    this.markDirty();
  }
}
