import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ArticleBlockListComponent } from './article-block-list.component';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { AcademyDialogService } from '../../../../../shared/ui';
import { ArticleBlock } from '../../models/article.models';

describe('ArticleBlockListComponent', () => {
  let component: ArticleBlockListComponent;
  let fixture: ComponentFixture<ArticleBlockListComponent>;
  let stateMock: {
    blocks: ReturnType<typeof vi.fn>;
    selectedBlockId: ReturnType<typeof vi.fn>;
    isSaving: ReturnType<typeof vi.fn>;
    selectBlock: ReturnType<typeof vi.fn>;
    createBlock: ReturnType<typeof vi.fn>;
    reorderBlocks: ReturnType<typeof vi.fn>;
    deleteBlock: ReturnType<typeof vi.fn>;
  };
  let dialogMock: {
    danger: ReturnType<typeof vi.fn>;
  };

  const sampleBlocks: ArticleBlock[] = [
    {
      id: 'b-1',
      articleId: 'art-1',
      type: 'HEADING',
      position: 0,
      content: { text: 'Heading 1', level: 2 },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-25T10:00:00Z',
    },
    {
      id: 'b-2',
      articleId: 'art-1',
      type: 'CODE',
      position: 1,
      content: { code: 'console.log("hello");', language: 'typescript' },
      mediaAssetId: null,
      schemaVersion: 1,
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-25T10:00:00Z',
    },
  ];

  beforeEach(async () => {
    stateMock = {
      blocks: vi.fn().mockReturnValue(sampleBlocks),
      selectedBlockId: vi.fn().mockReturnValue('b-1'),
      isSaving: vi.fn().mockReturnValue(false),
      selectBlock: vi.fn(),
      createBlock: vi.fn().mockResolvedValue(true),
      reorderBlocks: vi.fn().mockResolvedValue(true),
      deleteBlock: vi.fn().mockResolvedValue(true),
    };
    dialogMock = {
      danger: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleBlockListComponent],
      providers: [
        { provide: ArticleEditorStateService, useValue: stateMock },
        { provide: AcademyDialogService, useValue: dialogMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleBlockListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should render block list count and available block items', () => {
    expect(component.state.blocks().length).toBe(2);
    expect(component.getBlockSnippet(sampleBlocks[0])).toBe('Heading 1');
    expect(component.getBlockSnippet(sampleBlocks[1])).toContain('typescript');
  });

  it('2. should select block when clicked', () => {
    component.state.selectBlock('b-2');
    expect(stateMock.selectBlock).toHaveBeenCalledWith('b-2');
  });

  it('3. should toggle add block menu', () => {
    expect(component.showAddMenu()).toBe(false);
    component.toggleAddMenu();
    expect(component.showAddMenu()).toBe(true);
  });

  it('4. should add new block with appropriate default payload', async () => {
    await component.onAddBlock('QUOTE');

    expect(stateMock.createBlock).toHaveBeenCalledWith('QUOTE', expect.objectContaining({
      quote: expect.any(String),
      author: expect.any(String),
    }));
  });

  it('5. should move block down and up with accessible controls', async () => {
    await component.moveDown(0);
    expect(stateMock.reorderBlocks).toHaveBeenCalledWith(['b-2', 'b-1']);

    await component.moveUp(1);
    expect(stateMock.reorderBlocks).toHaveBeenCalledWith(['b-2', 'b-1']);
  });

  it('6. should confirm before deleting block', async () => {
    await component.onDeleteBlock(sampleBlocks[0]);

    expect(dialogMock.danger).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Delete Content Block',
    }));
    expect(stateMock.deleteBlock).toHaveBeenCalledWith('b-1');
  });

  it('7. should not delete if confirmation is cancelled', async () => {
    dialogMock.danger.mockResolvedValue(false);

    await component.onDeleteBlock(sampleBlocks[0]);

    expect(stateMock.deleteBlock).not.toHaveBeenCalled();
  });
});
