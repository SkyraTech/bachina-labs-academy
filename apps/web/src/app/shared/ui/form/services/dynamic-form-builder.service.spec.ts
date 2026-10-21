import { TestBed } from '@angular/core/testing';
import { DynamicFormBuilderService } from './dynamic-form-builder.service';
import { FormFieldConfig } from '../models';

describe('DynamicFormBuilderService', () => {
  let service: DynamicFormBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DynamicFormBuilderService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should build a form with default values and validation', () => {
    const fields: FormFieldConfig[] = [
      {
        name: 'email',
        label: 'Email',
        type: 'email',
        defaultValue: 'test@example.com',
        validation: { required: true },
      },
      {
        name: 'age',
        label: 'Age',
        type: 'number',
        validation: { min: 18 },
      },
    ];

    const form = service.buildForm(fields);

    expect(form.contains('email')).toBe(true);
    expect(form.contains('age')).toBe(true);
    expect(form.get('email')?.value).toBe('test@example.com');
    expect(form.get('age')?.value).toBeNull();
  });

  it('should validate required and email fields correctly', () => {
    const fields: FormFieldConfig[] = [
      {
        name: 'email',
        label: 'Email',
        type: 'email',
        validation: { required: true },
      },
    ];

    const form = service.buildForm(fields);
    const emailControl = form.get('email');

    expect(emailControl?.valid).toBe(false);
    expect(emailControl?.hasError('required')).toBe(true);

    emailControl?.setValue('invalid-email');
    expect(emailControl?.hasError('email')).toBe(true);

    emailControl?.setValue('valid@example.com');
    expect(emailControl?.valid).toBe(true);
  });

  it('should produce user-friendly error messages', () => {
    const field: FormFieldConfig = {
      name: 'username',
      label: 'Username',
      type: 'text',
      validation: { required: true, minLength: 3 },
    };

    const form = service.buildForm([field]);
    const control = form.get('username')!;

    // Not touched -> null
    expect(service.getErrorMessage(control, field)).toBeNull();

    control.markAsTouched();
    expect(service.getErrorMessage(control, field)).toBe('Username is required');

    control.setValue('ab');
    expect(service.getErrorMessage(control, field)).toBe('Username must be at least 3 characters');
  });
});
