import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RichTextVisualEditorComponent } from './rich-text-visual-editor.component';
import { validateLinkUrl, validateSourceHtml } from './tiptap-schema.config';

@Component({
  standalone: true,
  imports: [RichTextVisualEditorComponent],
  template: `
    <app-rich-text-visual-editor
      [content]="contentSignal()"
      [blockId]="blockIdSignal()"
      [disabled]="disabledSignal()"
      (contentChange)="onContentChange($event)"
      (isDirtyChange)="onDirtyChange($event)"
      (sourceValidChange)="onSourceValidChange($event)"
    />
  `,
})
class TestHostComponent {
  readonly contentSignal = signal<string>('<p>Initial text</p>');
  readonly blockIdSignal = signal<string | null>('b-1');
  readonly disabledSignal = signal<boolean>(false);
  lastEmittedContent = '';
  dirtyEmitted = false;
  sourceValidEmitted = true;

  onContentChange(val: string): void {
    this.lastEmittedContent = val;
  }

  onDirtyChange(val: boolean): void {
    this.dirtyEmitted = val;
  }

  onSourceValidChange(val: boolean): void {
    this.sourceValidEmitted = val;
  }
}

describe('RichTextVisualEditorComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let component: RichTextVisualEditorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, RichTextVisualEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    component = fixture.debugElement.children[0].componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('1. should create and initialize with default visual mode', () => {
    expect(component).toBeTruthy();
    expect(component.mode()).toBe('visual');
    expect(component.editor).toBeTruthy();
    expect(component.editor?.getHTML()).toContain('Initial text');
  });

  it('2. should not mark dirty on initial load', () => {
    expect(host.dirtyEmitted).toBe(false);
  });

  it('3. should update editor content when host input signal changes (block switch)', () => {
    host.contentSignal.set('<p>Switched block content</p>');
    fixture.detectChanges();
    expect(component.editor?.getHTML()).toContain('Switched block content');
  });

  it('4. should execute bold formatting and update active state', () => {
    component.editor?.commands.setContent('<p>Testing bold</p>', { emitUpdate: false });
    component.editor?.commands.selectAll();
    component.toggleBold();
    fixture.detectChanges();

    expect(component.editor?.getHTML()).toContain('<strong>Testing bold</strong>');
    expect(component.isBold()).toBe(true);
  });

  it('5. should execute italic formatting', () => {
    component.editor?.commands.setContent('<p>Testing italic</p>', { emitUpdate: false });
    component.editor?.commands.selectAll();
    component.toggleItalic();
    fixture.detectChanges();

    expect(component.editor?.getHTML()).toContain('<em>Testing italic</em>');
    expect(component.isItalic()).toBe(true);
  });

  it('6. should execute underline and strikethrough formatting', () => {
    component.editor?.commands.setContent('<p>Format</p>', { emitUpdate: false });
    component.editor?.commands.selectAll();
    component.toggleUnderline();
    component.toggleStrike();
    fixture.detectChanges();

    const html = component.editor?.getHTML();
    expect(html).toContain('<u>');
    expect(html).toContain('<s>');
  });

  it('7. should execute inline code and code block formatting', () => {
    component.editor?.commands.setContent('<p>Code test</p>', { emitUpdate: false });
    component.editor?.commands.selectAll();
    component.toggleCode();
    fixture.detectChanges();

    expect(component.editor?.getHTML()).toContain('<code>Code test</code>');
  });

  it('8. should execute subscript and superscript formatting', () => {
    component.editor?.commands.setContent('<p>H2O</p>', { emitUpdate: false });
    component.editor?.commands.selectAll();
    component.toggleSubscript();
    fixture.detectChanges();

    expect(component.editor?.getHTML()).toContain('<sub>H2O</sub>');
  });

  it('9. should create bullet and ordered lists', () => {
    component.editor?.commands.setContent('<p>List item</p>', { emitUpdate: false });
    component.toggleBulletList();
    fixture.detectChanges();

    expect(component.editor?.getHTML()).toContain('<ul><li><p>List item</p></li></ul>');
  });

  it('10. should create blockquote', () => {
    component.editor?.commands.setContent('<p>Quote me</p>', { emitUpdate: false });
    component.toggleBlockquote();
    fixture.detectChanges();

    expect(component.editor?.getHTML()).toContain('<blockquote><p>Quote me</p></blockquote>');
  });

  it('11. should open link dialog and apply valid link with title without target or rel', () => {
    component.editor?.commands.setContent('<p>Visit site</p>', { emitUpdate: false });
    component.editor?.commands.selectAll();
    component.openLinkDialog();
    fixture.detectChanges();

    expect(component.isLinkDialogOpen()).toBe(true);
    component.linkUrlInput.set('https://example.com/docs');
    component.linkTitleInput.set('Documentation');
    component.applyLink();
    fixture.detectChanges();

    const html = component.editor?.getHTML();
    expect(html).toContain('<a href="https://example.com/docs" title="Documentation">Visit site</a>');
    expect(html).not.toContain('target=');
    expect(html).not.toContain('rel=');
    expect(component.isLinkDialogOpen()).toBe(false);
  });

  it('12. should reject unsafe link protocols in link dialog', () => {
    component.openLinkDialog();
    component.linkUrlInput.set('javascript:alert(1)');
    component.applyLink();
    fixture.detectChanges();

    expect(component.linkError()).toContain('http: or https:');
    expect(component.isLinkDialogOpen()).toBe(true);
  });

  it('13. should remove an existing link', () => {
    component.editor?.commands.setContent('<p><a href="https://example.com">Site</a></p>', { emitUpdate: false });
    component.editor?.commands.selectAll();
    component.updateActiveStates();
    expect(component.isLink()).toBe(true);

    component.openLinkDialog();
    component.removeLink();
    fixture.detectChanges();

    expect(component.editor?.getHTML()).toBe('<p>Site</p>');
  });

  it('14. should switch from visual to HTML source mode', () => {
    component.editor?.commands.setContent('<p><strong>Bold</strong></p>', { emitUpdate: false });
    component.setMode('source');
    fixture.detectChanges();

    expect(component.mode()).toBe('source');
    expect(component.sourceHtml()).toContain('<strong>Bold</strong>');
  });

  it('15. should prevent switching to visual mode when source contains invalid HTML', () => {
    component.setMode('source');
    fixture.detectChanges();

    component.onSourceChange('<p class="forbidden">Invalid</p>');
    component.setMode('visual');
    fixture.detectChanges();

    // Mode must remain 'source' and error banner must be populated
    expect(component.mode()).toBe('source');
    expect(component.sourceError()).toContain('Attributes are not permitted on <p>');
    expect(host.sourceValidEmitted).toBe(false);
  });

  it('16. should successfully switch to visual mode when source contains valid HTML', () => {
    component.setMode('source');
    fixture.detectChanges();

    component.onSourceChange('<p><em>Clean italic</em></p>');
    component.setMode('visual');
    fixture.detectChanges();

    expect(component.mode()).toBe('visual');
    expect(component.sourceError()).toBeNull();
    expect(component.editor?.getHTML()).toContain('<em>Clean italic</em>');
  });

  it('17. should strip disallowed attributes during visual serialization', () => {
    component.editor?.commands.setContent('<p class="bad" style="color:red">Test</p>', { emitUpdate: false });
    const serialized = component.editor?.getHTML();
    expect(serialized).toBe('<p>Test</p>');
  });

  it('18. should clean up editor instance on destroy', () => {
    const destroySpy = vi.spyOn(component.editor!, 'destroy');
    component.ngOnDestroy();
    expect(destroySpy).toHaveBeenCalled();
    expect(component.editor).toBeNull();
  });

  it('19. should emit valid content directly from Source mode without switching back to Visual', () => {
    component.setMode('source');
    fixture.detectChanges();

    component.onSourceChange('<p><strong>Direct source edit</strong></p>');
    fixture.detectChanges();

    expect(host.lastEmittedContent).toBe('<p><strong>Direct source edit</strong></p>');
    expect(host.dirtyEmitted).toBe(true);
    expect(host.sourceValidEmitted).toBe(true);
    expect(component.sourceError()).toBeNull();
    expect(component.mode()).toBe('source');
  });

  it('20. should emit sourceValid = false on invalid source edit and retain error banner', () => {
    component.setMode('source');
    fixture.detectChanges();

    component.onSourceChange('<p style="color:red">Illegal style</p>');
    fixture.detectChanges();

    expect(host.sourceValidEmitted).toBe(false);
    expect(component.sourceError()).toContain('Attributes are not permitted on <p>');
  });

  it('21. should re-emit sourceValid = true when invalid source is corrected', () => {
    component.setMode('source');
    fixture.detectChanges();

    component.onSourceChange('<p class="bad">Bad</p>');
    expect(host.sourceValidEmitted).toBe(false);

    component.onSourceChange('<p>Corrected</p>');
    expect(host.sourceValidEmitted).toBe(true);
    expect(component.sourceError()).toBeNull();
    expect(host.lastEmittedContent).toBe('<p>Corrected</p>');
  });

  it('22. should reset to Visual mode and clear errors when blockId changes (block switching)', () => {
    component.setMode('source');
    component.onSourceChange('<p class="bad">Error in Block 1</p>');
    expect(component.sourceError()).not.toBeNull();
    expect(component.mode()).toBe('source');

    // Switch to Block 2
    host.blockIdSignal.set('b-2');
    host.contentSignal.set('<p>Block 2 fresh text</p>');
    fixture.detectChanges();

    expect(component.mode()).toBe('visual');
    expect(component.sourceError()).toBeNull();
    expect(host.sourceValidEmitted).toBe(true);
    expect(component.editor?.getHTML()).toContain('Block 2 fresh text');
  });

  it('23. should synchronize when blockId changes even if consecutive blocks have identical HTML', () => {
    host.contentSignal.set('<p>Same text</p>');
    host.blockIdSignal.set('b-alpha');
    fixture.detectChanges();

    // User edits in visual mode
    component.editor?.commands.setContent('<p>Same text modified</p>', { emitUpdate: false });

    // Switch to Block Beta which happens to have the original '<p>Same text</p>'
    host.blockIdSignal.set('b-beta');
    fixture.detectChanges();

    expect(component.editor?.getHTML()).toContain('Same text');
  });

  it('24. should restore authoritative content and clear error when content signal resets (Cancel simulation)', () => {
    component.setMode('source');
    component.onSourceChange('<p class="invalid">Dirty error</p>');
    expect(component.sourceError()).not.toBeNull();

    // Simulate parent Cancel resetting to authoritative content
    host.contentSignal.set('<p>Original server text</p>');
    fixture.detectChanges();

    expect(component.sourceError()).toBeNull();
    expect(component.sourceHtml()).toBe('<p>Original server text</p>');
    expect(component.editor?.getHTML()).toContain('Original server text');
  });

  it('25. should enter Source-only compatibility mode and preserve exact HTML when loading unsupported legacy markup', () => {
    const legacyHtml = '<p><span class="legacy-format">Important text</span></p>';
    host.contentSignal.set(legacyHtml);
    host.blockIdSignal.set('b-legacy');
    fixture.detectChanges();

    expect(component.mode()).toBe('source');
    expect(component.isLegacyFallback()).toBe(true);
    expect(component.legacyNotice()).toContain('Compatibility Notice');
    expect(component.sourceHtml()).toBe(legacyHtml);
  });

  it('26. should prevent switching to Visual mode while legacy unsupported HTML is present', () => {
    const legacyHtml = '<p><span class="legacy-format">Important text</span></p>';
    host.contentSignal.set(legacyHtml);
    host.blockIdSignal.set('b-legacy-2');
    fixture.detectChanges();

    component.setMode('visual');

    expect(component.mode()).toBe('source');
    expect(component.sourceError()).toContain('Unsupported HTML tag <span>');
  });

  it('27. should clear legacy notice and permit Visual mode once legacy HTML is corrected', () => {
    const legacyHtml = '<p><span class="legacy-format">Important text</span></p>';
    host.contentSignal.set(legacyHtml);
    host.blockIdSignal.set('b-legacy-3');
    fixture.detectChanges();

    expect(component.isLegacyFallback()).toBe(true);

    // Correct to valid strong tag
    component.onSourceChange('<p><strong>Important text</strong></p>');

    expect(component.isLegacyFallback()).toBe(false);
    expect(component.legacyNotice()).toBeNull();
    expect(component.sourceError()).toBeNull();

    component.setMode('visual');
    expect(component.mode()).toBe('visual');
    expect(component.editor?.getHTML()).toContain('Important text');
  });
});

describe('Tiptap Schema and Source Validators', () => {
  it('should validate URLs with absolute HTTP/HTTPS and no credentials', () => {
    expect(validateLinkUrl('https://example.com').isValid).toBe(true);
    expect(validateLinkUrl('http://example.com/path?query=1').isValid).toBe(true);
    expect(validateLinkUrl('ftp://example.com').isValid).toBe(false);
    expect(validateLinkUrl('javascript:alert(1)').isValid).toBe(false);
    expect(validateLinkUrl('data:text/html,test').isValid).toBe(false);
    expect(validateLinkUrl('/relative/path').isValid).toBe(false);
    expect(validateLinkUrl('https://user:pass@example.com').isValid).toBe(false);
  });

  it('should validate source HTML against 15 whitelisted tags and attribute rules', () => {
    expect(validateSourceHtml('<p>Valid text</p>').isValid).toBe(true);
    expect(validateSourceHtml('<blockquote><p>Quote</p></blockquote>').isValid).toBe(true);
    expect(validateSourceHtml('<p><a href="https://example.com" title="Test">Link</a></p>').isValid).toBe(true);

    // Forbidden tags
    expect(validateSourceHtml('<h1>Heading</h1>').isValid).toBe(false);
    expect(validateSourceHtml('<div>Div</div>').isValid).toBe(false);
    expect(validateSourceHtml('<span>Span</span>').isValid).toBe(false);
    expect(validateSourceHtml('<script>alert(1)</script>').isValid).toBe(false);

    // Forbidden attributes
    expect(validateSourceHtml('<p class="test">Para</p>').isValid).toBe(false);
    expect(validateSourceHtml('<strong style="font-weight:bold">Bold</strong>').isValid).toBe(false);
    expect(validateSourceHtml('<a href="https://ex.com" target="_blank">Link</a>').isValid).toBe(false);
    expect(validateSourceHtml('<a href="https://ex.com" rel="noopener">Link</a>').isValid).toBe(false);
  });
});
