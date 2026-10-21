import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormDialogComponent, FormDialogData } from './form-dialog.component';

describe('FormDialogComponent', () => {
  let component: FormDialogComponent;
  let fixture: ComponentFixture<FormDialogComponent>;
  let mockDialogRef: { close: ReturnType<typeof vi.fn> };

  const mockData: FormDialogData = {
    title: 'Edit Profile',
    description: 'Update your display details',
    fields: [
      { name: 'bio', label: 'Biography', type: 'text', defaultValue: 'Software Engineer' },
    ],
  };

  beforeEach(async () => {
    mockDialogRef = {
      close: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [FormDialogComponent],
      providers: [
        { provide: DIALOG_DATA, useValue: mockData },
        { provide: DialogRef, useValue: mockDialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should render dialog header with title and description', () => {
    const titleEl = fixture.nativeElement.querySelector('#form-dialog-title');
    expect(titleEl.textContent).toContain('Edit Profile');
  });

  it('should close with payload when onFormSubmit is triggered', () => {
    component.onFormSubmit({ bio: 'Lead Architect' });
    expect(mockDialogRef.close).toHaveBeenCalledWith({
      confirmed: true,
      payload: { bio: 'Lead Architect' },
    });
  });

  it('should close with confirmed: false on cancel', () => {
    component.onCancel();
    expect(mockDialogRef.close).toHaveBeenCalledWith({ confirmed: false });
  });
});
