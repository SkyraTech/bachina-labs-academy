import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ArticleEditorComponent } from './article-editor.component';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { ToastService, AcademyDialogService } from '../../../../../shared/ui';
import { EditableArticle } from '../../models/article.models';
import { of } from 'rxjs';

describe('ArticleEditorComponent', () => {
  let component: ArticleEditorComponent;
  let fixture: ComponentFixture<ArticleEditorComponent>;
  let stateService: ArticleEditorStateService;
  let dialogService: AcademyDialogService & { confirm: ReturnType<typeof vi.fn>; danger: ReturnType<typeof vi.fn> };

  const mockArticle: EditableArticle = {
    id: 'art-edit-1',
    authorId: 'auth-1',
    title: 'Microservices Communication Patterns',
    draftSlug: 'microservices-communication-patterns',
    publishedSlug: null,
    summary: 'Synchronous vs Asynchronous patterns in cloud microservices.',
    status: 'DRAFT',
    typographyPreset: 'MODERN_SANS',
    coverMediaId: null,
    draftRevision: 3,
    publishedRevision: 0,
    currentSnapshotId: null,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
    publishedAt: null,
    blocks: [
      {
        id: 'b-1',
        articleId: 'art-edit-1',
        type: 'HEADING',
        position: 0,
        content: { text: 'gRPC vs REST', level: 2 },
        mediaAssetId: null,
        schemaVersion: 1,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
      },
    ],
  };

  beforeEach(async () => {
    const apiMock = {
      getArticle: vi.fn().mockReturnValue(of(mockArticle)),
      updateDraftMetadata: vi.fn(),
      createBlock: vi.fn(),
      updateBlock: vi.fn(),
      deleteBlock: vi.fn(),
      reorderBlocks: vi.fn(),
      publishArticle: vi.fn(),
    };

    const dialogMock = {
      confirm: vi.fn().mockResolvedValue(true),
      danger: vi.fn().mockResolvedValue(true),
    };

    const toastMock = {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      show: vi.fn(),
    };

    const activatedRouteMock = {
      snapshot: {
        paramMap: {
          get: (key: string) => (key === 'articleId' ? 'art-edit-1' : null),
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [ArticleEditorComponent],
      providers: [
        { provide: ActivatedRoute, useValue: activatedRouteMock },
        { provide: ArticleEditorApiService, useValue: apiMock },
        { provide: AcademyDialogService, useValue: dialogMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleEditorComponent);
    component = fixture.componentInstance;
    stateService = fixture.debugElement.injector.get(ArticleEditorStateService);
    dialogService = TestBed.inject(AcademyDialogService) as AcademyDialogService & {
      confirm: ReturnType<typeof vi.fn>;
      danger: ReturnType<typeof vi.fn>;
    };
    fixture.detectChanges();
  });

  it('1. should load article from route param on init', () => {
    expect(stateService.article()?.id).toBe('art-edit-1');
    expect(stateService.article()?.title).toBe('Microservices Communication Patterns');
    expect(stateService.currentRevision()).toBe(3);
  });

  it('2. should display conflict banner when concurrency conflict occurs', () => {
    stateService.saveState.set('CONFLICT');
    stateService.conflictMessage.set('Revision Conflict (409): Concurrent update detected.');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Revision Conflict (409)');
    expect(el.textContent).toContain('Reload Authoritative Draft');
  });

  it('3. should toggle active tab between editor and preview', () => {
    expect(stateService.activeTab()).toBe('editor');

    stateService.setTab('preview');
    fixture.detectChanges();

    expect(stateService.activeTab()).toBe('preview');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-article-preview')).toBeTruthy();
  });

  it('4. should switch mobile navigation tabs', () => {
    expect(component.mobileTab()).toBe('content');

    component.mobileTab.set('outline');
    expect(component.mobileTab()).toBe('outline');

    component.mobileTab.set('settings');
    expect(component.mobileTab()).toBe('settings');
  });

  it('5. should map status variants accurately', () => {
    expect(component.getStatusVariant('PUBLISHED')).toBe('success');
    expect(component.getStatusVariant('DRAFT')).toBe('neutral');
    expect(component.getStatusVariant('ARCHIVED')).toBe('error');
  });

  it('6. should render unsaved block-switch confirmation dialog when showUnsavedSwitchDialog is true', () => {
    stateService.showUnsavedSwitchDialog.set(true);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[data-testid="unsaved-switch-dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(fixture.nativeElement.querySelector('[data-testid="unsaved-save-btn"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="unsaved-discard-btn"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="unsaved-keep-btn"]')).toBeTruthy();
  });

  it('7. should trigger dismissUnsavedSwitch when Keep Editing is clicked', () => {
    stateService.showUnsavedSwitchDialog.set(true);
    const dismissSpy = vi.spyOn(stateService, 'dismissUnsavedSwitch');
    fixture.detectChanges();

    const keepBtn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="unsaved-keep-btn"]');
    keepBtn.click();

    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it('8. should trigger discardAndSwitch when Discard and Switch is clicked', () => {
    stateService.showUnsavedSwitchDialog.set(true);
    const discardSpy = vi.spyOn(stateService, 'discardAndSwitch');
    fixture.detectChanges();

    const discardBtn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="unsaved-discard-btn"]');
    discardBtn.click();

    expect(discardSpy).toHaveBeenCalledTimes(1);
  });

  it('9. should trigger saveAndSwitch when Save and Switch is clicked', () => {
    stateService.showUnsavedSwitchDialog.set(true);
    const saveSpy = vi.spyOn(stateService, 'saveAndSwitch');
    fixture.detectChanges();

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="unsaved-save-btn"]');
    saveBtn.click();

    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('10. should coordinate sticky studio header offset below dashboard topbar and switch tabs via real clicks', async () => {
    stateService.setTab('editor');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('header.editor-sticky-header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.classList.contains('top-0')).toBe(false);
    expect(header.classList.contains('sticky')).toBe(true);
    expect(header.classList.contains('z-20')).toBe(true);

    const headerTop = getComputedStyle(header).top;
    expect(['64px', 'var(--dashboard-topbar-height, 64px)']).toContain(headerTop);

    const backLink = header.querySelector('a[aria-label="Back to Articles"]') as HTMLAnchorElement;
    const previewBtn = Array.from(header.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Preview') as HTMLButtonElement;
    const editorBtn = Array.from(header.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Editor') as HTMLButtonElement;

    expect(backLink).toBeTruthy();
    expect(previewBtn).toBeTruthy();
    expect(editorBtn).toBeTruthy();

    previewBtn.click();
    fixture.detectChanges();
    expect(stateService.activeTab()).toBe('preview');
    expect(fixture.nativeElement.querySelector('app-article-preview')).toBeTruthy();

    editorBtn.click();
    fixture.detectChanges();
    expect(stateService.activeTab()).toBe('editor');
    expect(fixture.nativeElement.querySelector('app-article-block-editor')).toBeTruthy();
  });

  describe('Navigation & Unsaved Changes Protection (AUTHOR-06)', () => {
    beforeEach(() => {
      dialogService.confirm.mockReset();
    });

    it('11. should allow navigation without confirmation dialog when editor is clean', async () => {
      stateService.saveState.set('SAVED');
      stateService.isMetadataDirty.set(false);
      stateService.isBlockDirty.set(false);
      fixture.detectChanges();

      const canLeave = await component.canDeactivate();
      expect(canLeave).toBe(true);
      expect(dialogService.confirm).not.toHaveBeenCalled();
    });

    it('12. should intercept navigation and show dialog when metadata is dirty', async () => {
      stateService.isMetadataDirty.set(true);
      stateService.saveState.set('DIRTY');
      fixture.detectChanges();

      dialogService.confirm.mockResolvedValueOnce(false); // User chooses Stay
      const canLeave = await component.canDeactivate();

      expect(canLeave).toBe(false);
      expect(dialogService.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Unsaved changes',
          confirmLabel: 'Discard changes and leave',
          cancelLabel: 'Stay and continue editing',
        })
      );
    });

    it('13. should intercept navigation and show dialog when block is dirty', async () => {
      stateService.isBlockDirty.set(true);
      stateService.saveState.set('DIRTY');
      fixture.detectChanges();

      dialogService.confirm.mockResolvedValueOnce(false); // User chooses Stay
      const canLeave = await component.canDeactivate();

      expect(canLeave).toBe(false);
      expect(dialogService.confirm).toHaveBeenCalled();
    });

    it('14. should intercept navigation when both metadata and block are dirty', async () => {
      stateService.isMetadataDirty.set(true);
      stateService.isBlockDirty.set(true);
      stateService.saveState.set('DIRTY');
      fixture.detectChanges();

      dialogService.confirm.mockResolvedValueOnce(false);
      const canLeave = await component.canDeactivate();

      expect(canLeave).toBe(false);
      expect(dialogService.confirm).toHaveBeenCalled();
    });

    it('15. should cancel navigation and retain dirty state when user chooses Stay', async () => {
      stateService.isMetadataDirty.set(true);
      stateService.saveState.set('DIRTY');
      fixture.detectChanges();

      dialogService.confirm.mockResolvedValueOnce(false); // Stay
      const canLeave = await component.canDeactivate();

      expect(canLeave).toBe(false);
      expect(stateService.hasUnsavedChanges()).toBe(true);
      expect(stateService.isMetadataDirty()).toBe(true);
    });

    it('16. should allow navigation and discard dirty state when user chooses Discard', async () => {
      stateService.isMetadataDirty.set(true);
      stateService.saveState.set('DIRTY');
      fixture.detectChanges();

      dialogService.confirm.mockResolvedValueOnce(true); // Discard
      const canLeave = await component.canDeactivate();

      expect(canLeave).toBe(true);
      expect(stateService.hasUnsavedChanges()).toBe(false);
      expect(stateService.isMetadataDirty()).toBe(false);
      expect(stateService.saveState()).toBe('SAVED');
    });

    it('17. should allow navigation without dialog when edits were reverted to original values', async () => {
      stateService.isMetadataDirty.set(false);
      stateService.isBlockDirty.set(false);
      stateService.saveState.set('SAVED');
      fixture.detectChanges();

      const canLeave = await component.canDeactivate();
      expect(canLeave).toBe(true);
      expect(dialogService.confirm).not.toHaveBeenCalled();
    });

    it('18. should allow navigation without dialog after successful save', async () => {
      stateService.isMetadataDirty.set(false);
      stateService.isBlockDirty.set(false);
      stateService.saveState.set('SAVED');
      fixture.detectChanges();

      const canLeave = await component.canDeactivate();
      expect(canLeave).toBe(true);
      expect(dialogService.confirm).not.toHaveBeenCalled();
    });

    it('19. should protect navigation while a save is in-flight (saveState === SAVING)', async () => {
      stateService.saveState.set('SAVING');
      fixture.detectChanges();

      expect(component.hasUnsavedChanges()).toBe(true);
      dialogService.confirm.mockResolvedValueOnce(false);
      const canLeave = await component.canDeactivate();
      expect(canLeave).toBe(false);
      expect(dialogService.confirm).toHaveBeenCalled();
    });

    it('20. should protect navigation when a previous save failed (saveState === ERROR)', async () => {
      stateService.saveState.set('ERROR');
      stateService.errorMessage.set('Network timeout while saving block');
      fixture.detectChanges();

      expect(component.hasUnsavedChanges()).toBe(true);
      dialogService.confirm.mockResolvedValueOnce(false);
      const canLeave = await component.canDeactivate();
      expect(canLeave).toBe(false);
      expect(dialogService.confirm).toHaveBeenCalled();
    });

    it('21. should protect navigation when a 409 revision conflict exists (saveState === CONFLICT)', async () => {
      stateService.saveState.set('CONFLICT');
      stateService.conflictMessage.set('Stale revision conflict detected');
      fixture.detectChanges();

      expect(component.hasUnsavedChanges()).toBe(true);
      dialogService.confirm.mockResolvedValueOnce(false);
      const canLeave = await component.canDeactivate();
      expect(canLeave).toBe(false);
      expect(dialogService.confirm).toHaveBeenCalled();
    });

    it('22. should return correct asynchronous navigation result from canDeactivate', async () => {
      stateService.isMetadataDirty.set(true);
      dialogService.confirm.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(true), 10)));

      const canLeavePromise = component.canDeactivate();
      expect(canLeavePromise instanceof Promise).toBe(true);
      const result = await canLeavePromise;
      expect(result).toBe(true);
    });

    it('23. should deduplicate dialogs across multiple rapid navigation attempts', async () => {
      stateService.isMetadataDirty.set(true);
      stateService.saveState.set('DIRTY');
      let resolveDialog!: (val: boolean) => void;
      dialogService.confirm.mockImplementation(
        () => new Promise((resolve) => (resolveDialog = resolve))
      );

      const navPromise1 = component.canDeactivate();
      const navPromise2 = component.canDeactivate();

      expect(dialogService.confirm).toHaveBeenCalledTimes(1);

      resolveDialog(false);
      const [res1, res2] = await Promise.all([navPromise1, navPromise2]);

      expect(res1).toBe(false);
      expect(res2).toBe(false);
      expect(dialogService.confirm).toHaveBeenCalledTimes(1);
    });

    it('24. should attach and clean up beforeunload listener based on dirty state and destruction', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      stateService.isMetadataDirty.set(true);
      fixture.detectChanges();

      stateService.isMetadataDirty.set(false);
      stateService.saveState.set('SAVED');
      fixture.detectChanges();

      expect(addSpy).toHaveBeenCalledWith('beforeunload', component.onBeforeUnloadFn);
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', component.onBeforeUnloadFn);

      fixture.destroy();
      expect(addSpy).toHaveBeenCalledWith('beforeunload', component.onBeforeUnloadFn);
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', component.onBeforeUnloadFn);
    });

    it('25. onBeforeUnloadFn should call preventDefault and set returnValue when dirty, and do nothing when clean', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        returnValue: undefined as string | undefined,
      } as unknown as BeforeUnloadEvent;

      stateService.saveState.set('SAVED');
      stateService.isMetadataDirty.set(false);
      stateService.isBlockDirty.set(false);
      fixture.detectChanges();

      component.onBeforeUnloadFn(mockEvent);
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockEvent.returnValue).toBeUndefined();

      stateService.isMetadataDirty.set(true);
      stateService.saveState.set('DIRTY');
      fixture.detectChanges();

      component.onBeforeUnloadFn(mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockEvent.returnValue).toBe('');
    });
  });

  describe('TICKET-005 & TICKET-006: Undo Keyboard Shortcuts & Save Status UI', () => {
    it('should trigger state.undoDeleteBlock on Ctrl+Z when canUndo is true and focus not in input', () => {
      vi.spyOn(stateService, 'canUndo').mockReturnValue(true);
      const undoSpy = vi.spyOn(stateService, 'undoDeleteBlock').mockReturnValue(true);

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(undoSpy).toHaveBeenCalled();
    });

    it('should trigger state.undoDeleteBlock on Cmd+Z (Meta+Z)', () => {
      vi.spyOn(stateService, 'canUndo').mockReturnValue(true);
      const undoSpy = vi.spyOn(stateService, 'undoDeleteBlock').mockReturnValue(true);

      const event = new KeyboardEvent('keydown', {
        key: 'Z',
        metaKey: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(undoSpy).toHaveBeenCalled();
    });

    it('should NOT trigger undo when Shift is held (Ctrl+Shift+Z)', () => {
      vi.spyOn(stateService, 'canUndo').mockReturnValue(true);
      const undoSpy = vi.spyOn(stateService, 'undoDeleteBlock');

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
      });

      window.dispatchEvent(event);

      expect(undoSpy).not.toHaveBeenCalled();
    });

    it('should display formatted timestamp in Save Status Pill when saved', () => {
      const fixedDate = new Date('2026-11-22T15:45:00Z');
      stateService.lastSavedAt.set(fixedDate);
      stateService.saveState.set('SAVED');
      fixture.detectChanges();

      const pill = fixture.nativeElement.querySelector('.save-status-saved');
      expect(pill).toBeTruthy();
      expect(pill.textContent).toContain('All changes saved');
    });
  });
});
