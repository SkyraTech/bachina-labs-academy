import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { DialogConfig, DialogResult } from '../../models';

describe('ConfirmDialogComponent', () => {
  let component: ConfirmDialogComponent;
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let mockDialogRef: { close: ReturnType<typeof vi.fn> };

  const mockData: DialogConfig = {
    title: 'Delete Article',
    message: 'Are you sure you want to permanently delete this draft?',
    type: 'danger',
    destructive: true,
    confirmLabel: 'Delete Now',
    cancelLabel: 'Keep Draft',
  };

  beforeEach(async () => {
    mockDialogRef = {
      close: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent],
      providers: [
        { provide: DIALOG_DATA, useValue: mockData },
        { provide: DialogRef, useValue: mockDialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should render dialog title, message, and buttons', () => {
    const titleEl = fixture.nativeElement.querySelector('#dialog-title');
    const msgEl = fixture.nativeElement.querySelector('#dialog-description');

    expect(titleEl.textContent).toContain('Delete Article');
    expect(msgEl.textContent).toContain('Are you sure you want to permanently delete');
  });

  it('should close dialog with confirmed: true on confirm', () => {
    component.onConfirm();
    expect(mockDialogRef.close).toHaveBeenCalledWith({ confirmed: true } as DialogResult);
  });

  it('should close dialog with confirmed: false on cancel', () => {
    component.onCancel();
    expect(mockDialogRef.close).toHaveBeenCalledWith({ confirmed: false } as DialogResult);
  });

  it('should close dialog with confirmed: false on Escape key', () => {
    component.onEscape();
    expect(mockDialogRef.close).toHaveBeenCalledWith({ confirmed: false });
  });

  it('should keep dialog available and show error message on async confirmation failure', async () => {
    const failingConfig: DialogConfig = {
      title: 'Action',
      message: 'Processing',
      onConfirm: () => Promise.reject(new Error('Network failure')),
    };
    (component as unknown as { data: DialogConfig }).data = failingConfig;

    await component.onConfirm();

    expect(mockDialogRef.close).not.toHaveBeenCalled();
    expect(component.loading()).toBe(false);
    expect(component.errorMessage()).toBe('Network failure');
  });
});
