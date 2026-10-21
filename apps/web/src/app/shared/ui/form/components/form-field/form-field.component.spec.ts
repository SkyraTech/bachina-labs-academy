import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormFieldComponent } from './form-field.component';
import { FormFieldConfig } from '../../models';

describe('FormFieldComponent', () => {
  let component: FormFieldComponent;
  let fixture: ComponentFixture<FormFieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(FormFieldComponent);
    component = fixture.componentInstance;
  });

  it('should render a text input with correct label and attributes', () => {
    const field: FormFieldConfig = {
      name: 'title',
      label: 'Article Title',
      type: 'text',
      placeholder: 'Enter title',
      validation: { required: true },
    };
    const form = new FormGroup({
      title: new FormControl(''),
    });

    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector('label');
    const input = fixture.nativeElement.querySelector('input');

    expect(label.textContent).toContain('Article Title');
    expect(label.getAttribute('for')).toBe('field-title');
    expect(input.id).toBe('field-title');
    expect(input.placeholder).toBe('Enter title');
  });

  it('should reflect invalid state when touched and invalid', () => {
    const field: FormFieldConfig = {
      name: 'email',
      label: 'Email',
      type: 'email',
      validation: { required: true },
    };
    const form = new FormGroup({
      email: new FormControl(''),
    });

    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();

    // Initially not touched
    expect(component.isInvalid()).toBe(false);

    form.get('email')?.markAsTouched();
    form.get('email')?.setErrors({ required: true });
    component.refreshValidity();
    fixture.detectChanges();

    expect(component.isInvalid()).toBe(true);
    expect(component.errorMessage()).toContain('Email is required');
  });

  it('should toggle password visibility on show/hide action', () => {
    const field: FormFieldConfig = {
      name: 'password',
      label: 'Password',
      type: 'password',
      validation: { required: true },
    };
    const form = new FormGroup({
      password: new FormControl(''),
    });

    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input');
    const toggleBtn = fixture.nativeElement.querySelector('.password-toggle-btn');

    expect(input.type).toBe('password');
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');

    // Click toggle to reveal
    toggleBtn.click();
    fixture.detectChanges();

    expect(component.showPassword()).toBe(true);
    expect(input.type).toBe('text');
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');

    // Click again to hide
    toggleBtn.click();
    fixture.detectChanges();

    expect(component.showPassword()).toBe(false);
    expect(input.type).toBe('password');
  });
});
