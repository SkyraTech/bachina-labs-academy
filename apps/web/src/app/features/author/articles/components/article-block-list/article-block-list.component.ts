import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleBlock, ArticleBlockType } from '../../models/article.models';
import { AcademyDialogService } from '../../../../../shared/ui';

interface BlockTypeOption {
  type: ArticleBlockType;
  label: string;
  icon: string;
  description: string;
}

@Component({
  selector: 'app-article-block-list',
  standalone: true,
  imports: [CommonModule, DragDropModule],
  templateUrl: './article-block-list.component.html',
  styleUrl: './article-block-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleBlockListComponent {
  readonly state = inject(ArticleEditorStateService);
  private readonly dialog = inject(AcademyDialogService);

  readonly showAddMenu = signal(false);

  readonly availableBlockTypes: BlockTypeOption[] = [
    { type: 'HEADING', label: 'Heading', icon: 'H#', description: 'Section title (H1–H4)' },
    { type: 'RICH_TEXT', label: 'Rich Text', icon: '¶', description: 'Formatted prose with links' },
    { type: 'CODE', label: 'Code Block', icon: '</>', description: 'Syntax-highlighted code' },
    { type: 'QUOTE', label: 'Blockquote', icon: '“ ”', description: 'Editorial quotation' },
    { type: 'CALLOUT', label: 'Callout', icon: 'ℹ', description: 'Info, Warning, Tip, Note' },
    { type: 'TABLE', label: 'Data Table', icon: '⊞', description: 'Structured tabular data' },
    { type: 'DIVIDER', label: 'Divider', icon: '—', description: 'Horizontal section break' },
    { type: 'LINK_CARD', label: 'Link Card', icon: '🔗', description: 'External URL card' },
    { type: 'VIDEO', label: 'Video Embed', icon: '▶', description: 'YouTube or Vimeo embed' },
    { type: 'IMAGE', label: 'Image Asset', icon: '🖼', description: 'Media asset with caption' },
  ];

  toggleAddMenu(): void {
    this.showAddMenu.update((v) => !v);
  }

  async onAddBlock(type: ArticleBlockType): Promise<void> {
    this.showAddMenu.set(false);

    let defaultContent: Record<string, unknown> = {};

    switch (type) {
      case 'HEADING':
        defaultContent = { text: 'New Heading', level: 2 };
        break;
      case 'RICH_TEXT':
        defaultContent = { html: '<p>Write your detailed technical explanation here...</p>' };
        break;
      case 'CODE':
        defaultContent = { code: '// Technical implementation code', language: 'typescript', showLineNumbers: true };
        break;
      case 'QUOTE':
        defaultContent = { quote: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra' };
        break;
      case 'CALLOUT':
        defaultContent = { variant: 'INFO', title: 'Note', body: 'Important operational detail to keep in mind.' };
        break;
      case 'TABLE':
        defaultContent = {
          headers: ['Metric', 'Baseline', 'Target'],
          rows: [
            ['P99 Latency', '120ms', '< 50ms'],
            ['Throughput', '10k RPS', '50k RPS'],
          ],
        };
        break;
      case 'DIVIDER':
        defaultContent = {};
        break;
      case 'LINK_CARD':
        defaultContent = {
          url: 'https://bachinalabs.com',
          title: 'Bachina Labs Academy',
          description: 'Production-ready cloud architecture tutorials and engineering blueprints.',
        };
        break;
      case 'VIDEO':
        defaultContent = {
          provider: 'YOUTUBE',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          caption: 'Architectural overview video',
        };
        break;
      case 'IMAGE':
        defaultContent = {
          caption: 'Architectural diagram overview',
          altText: 'Database topology diagram',
        };
        break;
    }

    await this.state.createBlock(type, defaultContent);
  }

  async onDrop(event: CdkDragDrop<ArticleBlock[]>): Promise<void> {
    if (event.previousIndex === event.currentIndex) return;

    const currentBlocks = [...this.state.blocks()];
    moveItemInArray(currentBlocks, event.previousIndex, event.currentIndex);

    const orderedIds = currentBlocks.map((b) => b.id);
    await this.state.reorderBlocks(orderedIds);
  }

  async moveUp(index: number): Promise<void> {
    if (index <= 0) return;
    const currentBlocks = [...this.state.blocks()];
    moveItemInArray(currentBlocks, index, index - 1);
    const orderedIds = currentBlocks.map((b) => b.id);
    await this.state.reorderBlocks(orderedIds);
  }

  async moveDown(index: number): Promise<void> {
    const blocks = this.state.blocks();
    if (index >= blocks.length - 1) return;
    const currentBlocks = [...blocks];
    moveItemInArray(currentBlocks, index, index + 1);
    const orderedIds = currentBlocks.map((b) => b.id);
    await this.state.reorderBlocks(orderedIds);
  }

  async onDeleteBlock(block: ArticleBlock): Promise<void> {
    const confirmed = await this.dialog.danger({
      title: 'Delete Content Block',
      message: `Are you sure you want to delete this ${block.type} block? This action cannot be undone.`,
      confirmLabel: 'Delete Block',
      cancelLabel: 'Keep Block',
    });

    if (confirmed) {
      await this.state.deleteBlock(block.id);
    }
  }

  getBlockSnippet(block: ArticleBlock): string {
    const c = block.content;
    const str = (key: string): string =>
      typeof c[key] === 'string' ? (c[key] as string) : '';

    switch (block.type) {
      case 'HEADING':
        return str('text') || 'Empty Heading';
      case 'RICH_TEXT':
        return str('html').replace(/<[^>]*>/g, '').slice(0, 40) || 'Rich text content';
      case 'CODE':
        return `${str('language') || 'code'}: ${str('code').slice(0, 30)}`;
      case 'QUOTE':
        return `“${str('quote').slice(0, 35)}”`;
      case 'CALLOUT':
        return `[${str('variant')}] ${str('title') || str('body').slice(0, 25)}`;
      case 'TABLE': {
        const headers = Array.isArray(c['headers']) ? c['headers'] : [];
        const rows = Array.isArray(c['rows']) ? c['rows'] : [];
        return `Table (${headers.length} cols, ${rows.length} rows)`;
      }
      case 'DIVIDER':
        return 'Horizontal Divider';
      case 'LINK_CARD':
        return str('title') || str('url') || 'Link Card';
      case 'VIDEO':
        return `${str('provider')}: ${str('caption') || str('url')}`;
      case 'IMAGE':
        return str('caption') || str('altText') || 'Image Asset';
      default:
        return 'Block';
    }
  }
}
