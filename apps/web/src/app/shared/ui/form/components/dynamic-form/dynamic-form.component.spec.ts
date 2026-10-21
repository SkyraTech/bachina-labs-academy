import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { DynamicFormComponent } from './dynamic-form.component';
import { FormFieldConfig } from '../../models';

describe('DynamicFormComponent', () => {
  let component: DynamicFormComponent;
  let fixture: ComponentFixture<DynamicFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicFormComponent);
    component = fixture.componentInstance;
  });

  it('should initialize form group with provided fields', () => {
    const fields: FormFieldConfig[] = [
      { name: 'name', label: 'Name', type: 'text', defaultValue: 'John Doe' },
      { name: 'email', label: 'Email', type: 'email', defaultValue: 'john@example.com' },
    ];

    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();

    expect(component.formGroup).toBeTruthy();
    expect(component.formGroup.get('name')?.value).toBe('John Doe');
    expect(component.formGroup.get('email')?.value).toBe('john@example.com');
  });

  it('should not emit formSubmit if form is invalid on submit', () => {
    const fields: FormFieldConfig[] = [
      { name: 'requiredField', label: 'Required Field', type: 'text', validation: { required: true } },
    ];

    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();

    let submittedData: unknown = null;
    component.formSubmit.subscribe((data) => {
      submittedData = data;
    });

    component.onSubmit();

    expect(submittedData).toBeNull();
    expect(component.formGroup.get('requiredField')?.touched).toBe(true);
  });

  it('should emit formSubmit with values if form is valid', () => {
    const fields: FormFieldConfig[] = [
      { name: 'title', label: 'Title', type: 'text', defaultValue: 'Initial Title', validation: { required: true } },
    ];

    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();

    let submittedData: Record<string, unknown> | null = null;
    component.formSubmit.subscribe((data) => {
      submittedData = data;
    });

    component.onSubmit();

    expect(submittedData).toEqual({ title: 'Initial Title' });
  });

  it('should dynamically evaluate conditional visibility via visibleWhen', () => {
    const fields: FormFieldConfig[] = [
      { name: 'hasExperience', label: 'Has Experience', type: 'checkbox', defaultValue: false },
      {
        name: 'yearsOfExp',
        label: 'Years of Experience',
        type: 'number',
        visibleWhen: (val) => val['hasExperience'] === true,
      },
    ];

    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();

    // Initially false, field should not be visible
    expect(component.isFieldVisible(fields[1])).toBe(false);

    // Toggle hasExperience to true
    component.formGroup.get('hasExperience')?.setValue(true);
    fixture.detectChanges();
    expect(component.isFieldVisible(fields[1])).toBe(true);
  });

  it('should not block submit for hidden conditionally-required field, but enforce when visible', () => {
    const fields: FormFieldConfig[] = [
      { name: 'isMember', label: 'Member', type: 'checkbox', defaultValue: false },
      {
        name: 'memberId',
        label: 'Member ID',
        type: 'text',
        validation: { required: true },
        visibleWhen: (val) => val['isMember'] === true,
      },
    ];

    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();

    let submittedData: Record<string, unknown> | null = null;
    component.formSubmit.subscribe((d) => (submittedData = d));

    // When isMember is false, memberId is hidden and should NOT block submit
    component.onSubmit();
    expect(submittedData).toEqual({ isMember: false });

    // When isMember is true, memberId becomes visible and required
    submittedData = null;
    component.formGroup.get('isMember')?.setValue(true);
    fixture.detectChanges();

    component.onSubmit();
    expect(submittedData).toBeNull(); // blocked because memberId is required and empty!
  });

  it('should retain and submit hidden field values according to policy', () => {
    const fields: FormFieldConfig[] = [
      { name: 'recordId', label: 'ID', type: 'hidden', defaultValue: 'rec-12345' },
      { name: 'name', label: 'Name', type: 'text', defaultValue: 'Test Record' },
    ];

    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();

    let submittedData: Record<string, unknown> | null = null;
    component.formSubmit.subscribe((d) => (submittedData = d));

    component.onSubmit();
    expect(submittedData).toEqual({
      recordId: 'rec-12345',
      name: 'Test Record',
    });
  });
});
