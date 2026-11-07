import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  input,
  output,
  signal,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Editor } from '@tiptap/core';
import {
  createEditorExtensions,
  validateLinkUrl,
  validateSourceHtml,
} from './tiptap-schema.config';

@Component({
  selector: 'app-rich-text-visual-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rich-text-visual-editor.component.html',
  styleUrl: './rich-text-visual-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RichTextVisualEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('editorContainer') editorContainer!: ElementRef<HTMLDivElement>;

  readonly content = input<string>('');
  readonly blockId = input<string | null>(null);
  readonly disabled = input<boolean>(false);

  readonly contentChange = output<string>();
  readonly isDirtyChange = output<boolean>();
  readonly sourceValidChange = output<boolean>();

  readonly mode = signal<'visual' | 'source'>('visual');
  readonly sourceHtml = signal<string>('');
  readonly sourceError = signal<string | null>(null);
  readonly isFocused = signal<boolean>(false);
  readonly isLegacyFallback = signal<boolean>(false);
  readonly legacyNotice = signal<string | null>(null);

  // Active mark / node indicator signals for toolbar
  readonly isBold = signal<boolean>(false);
  readonly isItalic = signal<boolean>(false);
  readonly isUnderline = signal<boolean>(false);
  readonly isStrike = signal<boolean>(false);
  readonly isCode = signal<boolean>(false);
  readonly isSubscript = signal<boolean>(false);
  readonly isSuperscript = signal<boolean>(false);
  readonly isBulletList = signal<boolean>(false);
  readonly isOrderedList = signal<boolean>(false);
  readonly isBlockquote = signal<boolean>(false);
  readonly isCodeBlock = signal<boolean>(false);
  readonly isLink = signal<boolean>(false);
  readonly canUndo = signal<boolean>(false);
  readonly canRedo = signal<boolean>(false);

  // Link dialog modal / popover
  readonly isLinkDialogOpen = signal<boolean>(false);
  readonly linkUrlInput = signal<string>('');
  readonly linkTitleInput = signal<string>('');
  readonly linkError = signal<string | null>(null);

  editor: Editor | null = null;
  private isInternalUpdate = false;
  private lastAppliedContent = '';
  private lastAppliedBlockId: string | null = null;

  constructor() {
    // React to external content or block changes (e.g. switching blocks in parent or reset)
    effect(() => {
      const incoming = this.content();
      const currentBlockId = this.blockId();
      if (this.editor && !this.isInternalUpdate) {
        const isBlockChanged = currentBlockId !== this.lastAppliedBlockId;
        const isContentChanged = incoming !== this.lastAppliedContent;

        if (isBlockChanged) {
          this.lastAppliedBlockId = currentBlockId;
          this.lastAppliedContent = incoming;
          this.sourceHtml.set(incoming);
          this.sourceError.set(null);

          const validation = validateSourceHtml(incoming);
          if (!validation.isValid) {
            this.isLegacyFallback.set(true);
            this.legacyNotice.set(
              'Compatibility Notice: Unsupported or legacy HTML markup was detected in this block. The original markup has been preserved in Source mode. It must be edited to comply with current formatting standards before saving or returning to Visual mode.'
            );
            this.mode.set('source');
            this.sourceValidChange.emit(false);
          } else {
            this.isLegacyFallback.set(false);
            this.legacyNotice.set(null);
            this.sourceValidChange.emit(true);
            this.mode.set('visual');
            this.editor.commands.setContent(incoming, { emitUpdate: false });
            this.updateActiveStates();
          }
        } else if (isContentChanged) {
          this.lastAppliedContent = incoming;
          this.sourceHtml.set(incoming);
          this.sourceError.set(null);

          const validation = validateSourceHtml(incoming);
          if (!validation.isValid) {
            this.isLegacyFallback.set(true);
            this.legacyNotice.set(
              'Compatibility Notice: Unsupported or legacy HTML markup was detected in this block. The original markup has been preserved in Source mode. It must be edited to comply with current formatting standards before saving or returning to Visual mode.'
            );
            this.mode.set('source');
            this.sourceValidChange.emit(false);
          } else {
            this.isLegacyFallback.set(false);
            this.legacyNotice.set(null);
            this.sourceValidChange.emit(true);
            this.editor.commands.setContent(incoming, { emitUpdate: false });
            this.updateActiveStates();
          }
        }
      }
    });

    // React to disabled input changes
    effect(() => {
      const isDisabled = this.disabled();
      if (this.editor) {
        this.editor.setEditable(!isDisabled);
      }
    });
  }

  ngAfterViewInit(): void {
    const initialContent = this.content() || '<p></p>';
    this.lastAppliedContent = initialContent;
    this.lastAppliedBlockId = this.blockId();
    this.sourceHtml.set(initialContent);

    const validation = validateSourceHtml(initialContent);
    const isLegacy = !validation.isValid;

    if (isLegacy) {
      this.isLegacyFallback.set(true);
      this.legacyNotice.set(
        'Compatibility Notice: Unsupported or legacy HTML markup was detected in this block. The original markup has been preserved in Source mode. It must be edited to comply with current formatting standards before saving or returning to Visual mode.'
      );
      this.mode.set('source');
      this.sourceValidChange.emit(false);
    } else {
      this.isLegacyFallback.set(false);
      this.legacyNotice.set(null);
    }

    this.editor = new Editor({
      element: this.editorContainer.nativeElement,
      extensions: createEditorExtensions(),
      content: isLegacy ? '<p></p>' : initialContent,
      editable: !this.disabled(),
      editorProps: {
        attributes: {
          class: 'tiptap-content-canvas focus:outline-none min-h-[160px] p-3 text-sm leading-relaxed',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Document content editor',
        },
      },
      onUpdate: ({ editor }) => {
        if (this.mode() === 'source') {
          return;
        }
        this.isInternalUpdate = true;
        const html = editor.getHTML();
        this.lastAppliedContent = html;
        this.sourceHtml.set(html);
        this.sourceError.set(null);
        this.contentChange.emit(html);
        this.isDirtyChange.emit(true);
        this.sourceValidChange.emit(true);
        this.updateActiveStates();
        this.isInternalUpdate = false;
      },
      onSelectionUpdate: () => {
        this.updateActiveStates();
      },
      onFocus: () => {
        this.isFocused.set(true);
        this.updateActiveStates();
      },
      onBlur: () => {
        this.isFocused.set(false);
      },
    });

    this.updateActiveStates();
  }

  ngOnDestroy(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  }

  updateActiveStates(): void {
    if (!this.editor) return;
    this.isBold.set(this.editor.isActive('bold'));
    this.isItalic.set(this.editor.isActive('italic'));
    this.isUnderline.set(this.editor.isActive('underline'));
    this.isStrike.set(this.editor.isActive('strike'));
    this.isCode.set(this.editor.isActive('code'));
    this.isSubscript.set(this.editor.isActive('subscript'));
    this.isSuperscript.set(this.editor.isActive('superscript'));
    this.isBulletList.set(this.editor.isActive('bulletList'));
    this.isOrderedList.set(this.editor.isActive('orderedList'));
    this.isBlockquote.set(this.editor.isActive('blockquote'));
    this.isCodeBlock.set(this.editor.isActive('codeBlock'));
    this.isLink.set(this.editor.isActive('link'));
    this.canUndo.set(this.editor.can().undo());
    this.canRedo.set(this.editor.can().redo());
  }

  // Formatting actions
  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  toggleUnderline(): void {
    this.editor?.chain().focus().toggleUnderline().run();
  }

  toggleStrike(): void {
    this.editor?.chain().focus().toggleStrike().run();
  }

  toggleCode(): void {
    this.editor?.chain().focus().toggleCode().run();
  }

  toggleSubscript(): void {
    this.editor?.chain().focus().toggleSubscript().run();
  }

  toggleSuperscript(): void {
    this.editor?.chain().focus().toggleSuperscript().run();
  }

  toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  toggleBlockquote(): void {
    this.editor?.chain().focus().toggleBlockquote().run();
  }

  toggleCodeBlock(): void {
    this.editor?.chain().focus().toggleCodeBlock().run();
  }

  undo(): void {
    this.editor?.chain().focus().undo().run();
  }

  redo(): void {
    this.editor?.chain().focus().redo().run();
  }

  // Link dialog handling
  openLinkDialog(): void {
    if (!this.editor) return;
    if (this.isLink()) {
      const attrs = this.editor.getAttributes('link');
      this.linkUrlInput.set(attrs['href'] || '');
      this.linkTitleInput.set(attrs['title'] || '');
    } else {
      this.linkUrlInput.set('https://');
      this.linkTitleInput.set('');
    }
    this.linkError.set(null);
    this.isLinkDialogOpen.set(true);
  }

  applyLink(): void {
    const url = this.linkUrlInput().trim();
    const title = this.linkTitleInput().trim();

    const validation = validateLinkUrl(url);
    if (!validation.isValid) {
      this.linkError.set(validation.error || 'Invalid link URL.');
      return;
    }

    if (title.length > 255) {
      this.linkError.set('Link title must not exceed 255 characters.');
      return;
    }

    if (this.editor) {
      const linkAttrs: { href: string; title?: string } = { href: url };
      if (title) linkAttrs.title = title;

      if (this.editor.state.selection.empty && !this.isLink()) {
        const linkText = title || url;
        this.editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text: linkText,
            marks: [
              {
                type: 'link',
                attrs: linkAttrs,
              },
            ],
          })
          .run();
      } else {
        this.editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .setLink(linkAttrs)
          .run();
      }
    }

    this.isLinkDialogOpen.set(false);
    this.linkError.set(null);
  }

  removeLink(): void {
    if (this.editor) {
      this.editor.chain().focus().unsetLink().run();
    }
    this.isLinkDialogOpen.set(false);
    this.linkError.set(null);
  }

  closeLinkDialog(): void {
    this.isLinkDialogOpen.set(false);
    this.linkError.set(null);
    this.editor?.commands.focus();
  }

  // Mode switching
  setMode(targetMode: 'visual' | 'source'): void {
    if (this.mode() === targetMode) return;

    if (targetMode === 'source') {
      if (this.editor) {
        const html = this.editor.getHTML();
        this.sourceHtml.set(html);
        this.lastAppliedContent = html;
      }
      this.mode.set('source');
      this.validateCurrentSource();
    } else {
      // Switching back to visual: validate source first
      const raw = this.sourceHtml();
      const validation = validateSourceHtml(raw);
      if (!validation.isValid) {
        this.sourceError.set(validation.error || 'Invalid HTML source.');
        this.sourceValidChange.emit(false);
        // Do NOT switch to visual mode when source contains invalid HTML
        return;
      }

      this.isLegacyFallback.set(false);
      this.legacyNotice.set(null);
      this.sourceError.set(null);
      this.sourceValidChange.emit(true);
      if (this.editor) {
        this.editor.commands.setContent(raw, { emitUpdate: false });
        this.lastAppliedContent = this.editor.getHTML();
        this.contentChange.emit(this.lastAppliedContent);
        this.updateActiveStates();
      }
      this.mode.set('visual');
    }
  }

  onSourceChange(newVal: string): void {
    this.lastAppliedContent = newVal;
    this.sourceHtml.set(newVal);
    const validation = validateSourceHtml(newVal);
    if (!validation.isValid) {
      this.sourceError.set(validation.error || 'Invalid HTML.');
      this.sourceValidChange.emit(false);
    } else {
      this.isLegacyFallback.set(false);
      this.legacyNotice.set(null);
      this.sourceError.set(null);
      this.sourceValidChange.emit(true);
    }
    this.contentChange.emit(newVal);
    this.isDirtyChange.emit(true);
  }

  private validateCurrentSource(): void {
    const raw = this.sourceHtml();
    const validation = validateSourceHtml(raw);
    if (!validation.isValid) {
      this.sourceError.set(validation.error || 'Invalid HTML.');
      this.sourceValidChange.emit(false);
    } else {
      this.sourceError.set(null);
      this.sourceValidChange.emit(true);
    }
  }
}
