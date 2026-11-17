import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ArticleBlockListComponent } from './article-block-list.component';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { AcademyDialogService } from '../../../../../shared/ui';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { ArticleBlock } from '../../models/article.models';
import { MediaAssetDto } from '../../models/article-media.models';

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
  let mediaApiMock: {
    listMyMedia: ReturnType<typeof vi.fn>;
    uploadMedia: ReturnType<typeof vi.fn>;
    getPrivateMediaPreviewUrl: ReturnType<typeof vi.fn>;
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
    mediaApiMock = {
      listMyMedia: vi.fn().mockReturnValue(of({ items: [], total: 0, page: 1, limit: 12, totalPages: 1 })),
      uploadMedia: vi.fn(),
      getPrivateMediaPreviewUrl: vi.fn().mockReturnValue('/media/preview/123'),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleBlockListComponent],
      providers: [
        { provide: ArticleEditorStateService, useValue: stateMock },
        { provide: AcademyDialogService, useValue: dialogMock },
        { provide: ArticleMediaApiService, useValue: mediaApiMock },
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

  it('8. should render two-row block rail cards with accessible move and delete controls', () => {
    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('.block-rail-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('HEADING');
    expect(cards[0].textContent).toContain('Heading 1');
    expect(cards[0].querySelector('button[aria-label="Move block up"]')).toBeTruthy();
    expect(cards[0].querySelector('button[aria-label="Move block down"]')).toBeTruthy();
    expect(cards[0].querySelector('button[aria-label="Delete block"]')).toBeTruthy();
  });

  it('9. onAddBlock(IMAGE) should open media picker and NOT call createBlock immediately', async () => {
    expect(component.isImagePickerOpen()).toBe(false);
    await component.onAddBlock('IMAGE');

    expect(component.isImagePickerOpen()).toBe(true);
    expect(stateMock.createBlock).not.toHaveBeenCalled();
    expect(component.showAddMenu()).toBe(false);
  });

  it('10. onImageBlockMediaSelected should create IMAGE block with valid mediaAssetId and close picker', async () => {
    component.isImagePickerOpen.set(true);
    const mockAsset: MediaAssetDto = {
      id: 'a0000000-0000-4000-8000-000000000099',
      originalFilename: 'test.png',
      mimeType: 'image/png',
      fileSize: 1234,
      mediaType: 'IMAGE',
      width: 800,
      height: 600,
      createdAt: '2026-10-25T10:00:00Z',
    };

    await component.onImageBlockMediaSelected(mockAsset);

    expect(stateMock.createBlock).toHaveBeenCalledWith(
      'IMAGE',
      expect.objectContaining({
        caption: 'Architectural diagram overview',
        altText: 'test',
      }),
      'a0000000-0000-4000-8000-000000000099',
    );
    expect(component.isImagePickerOpen()).toBe(false);
    expect(component.isSubmittingImageBlock()).toBe(false);
  });

  it('11. onImagePickerClosed should close picker without creating any block', () => {
    component.isImagePickerOpen.set(true);
    component.onImagePickerClosed();

    expect(component.isImagePickerOpen()).toBe(false);
    expect(stateMock.createBlock).not.toHaveBeenCalled();
  });

  it('12. should prevent duplicate block creation while already submitting', async () => {
    component.isSubmittingImageBlock.set(true);
    const mockAsset: MediaAssetDto = {
      id: 'a0000000-0000-4000-8000-000000000099',
      originalFilename: 'test.png',
      mimeType: 'image/png',
      fileSize: 1234,
      mediaType: 'IMAGE',
      width: null,
      height: null,
      createdAt: '2026-10-25T10:00:00Z',
    };

    await component.onImageBlockMediaSelected(mockAsset);

    expect(stateMock.createBlock).not.toHaveBeenCalled();
  });

  it('13. should reset isSubmittingImageBlock on failure gracefully', async () => {
    stateMock.createBlock.mockRejectedValue(new Error('Network error'));
    const mockAsset: MediaAssetDto = {
      id: 'a0000000-0000-4000-8000-000000000099',
      originalFilename: 'test.png',
      mimeType: 'image/png',
      fileSize: 1234,
      mediaType: 'IMAGE',
      width: null,
      height: null,
      createdAt: '2026-10-25T10:00:00Z',
    };

    await expect(component.onImageBlockMediaSelected(mockAsset)).rejects.toThrow('Network error');
    expect(component.isSubmittingImageBlock()).toBe(false);
  });
});
