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
});
