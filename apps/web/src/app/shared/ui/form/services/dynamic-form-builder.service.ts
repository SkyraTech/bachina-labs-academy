import { Injectable, inject } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { FormFieldConfig, FormSectionConfig } from '../models';

/**
 * Service responsible for constructing reactive FormGroups from declarative configurations.
 */
@Injectable({
  providedIn: 'root',
})
export class DynamicFormBuilderService {
  private readonly fb = inject(FormBuilder);

  /**
   * Constructs an Angular FormGroup from a flat list of field configurations.
   */
  buildForm(fields: readonly FormFieldConfig[]): FormGroup {
    const group: Record<string, FormControl> = {};

    for (const field of fields) {
      group[field.name] = this.createControl(field);
    }

    return this.fb.group(group);
  }

  /**
   * Constructs an Angular FormGroup from an array of form sections.
   */
  buildFormFromSections(sections: readonly FormSectionConfig[]): FormGroup {
    const fields: FormFieldConfig[] = [];
    for (const section of sections) {
      fields.push(...section.fields);
    }
    return this.buildForm(fields);
  }

  /**
   * Creates a single FormControl with appropriate validators and default value.
   */
  private createControl(field: FormFieldConfig): FormControl {
    const validators: ValidatorFn[] = [];
    const val = field.validation;

    if (val?.required) {
      if (field.type === 'checkbox') {
        validators.push(Validators.requiredTrue);
      } else {
        validators.push(Validators.required);
      }
    }

    if (field.type === 'email') {
      validators.push(Validators.email);
    }

    if (val?.minLength !== undefined) {
      validators.push(Validators.minLength(val.minLength));
    }

    if (val?.maxLength !== undefined) {
      validators.push(Validators.maxLength(val.maxLength));
    }

    if (val?.min !== undefined) {
      validators.push(Validators.min(val.min));
    }

    if (val?.max !== undefined) {
      validators.push(Validators.max(val.max));
    }

    if (val?.pattern) {
      validators.push(Validators.pattern(val.pattern));
    }

    let initialValue: unknown = field.defaultValue;
    if (initialValue === undefined) {
      switch (field.type) {
        case 'checkbox':
        case 'toggle':
          initialValue = false;
          break;
        case 'multiselect':
          initialValue = [];
          break;
        case 'number':
          initialValue = null;
          break;
        default:
          initialValue = '';
          break;
      }
    }

    return new FormControl(
      {
        value: initialValue,
        disabled: !!field.disabled,
      },
      validators,
    );
  }

  /**
   * Extracts a user-friendly error message for an invalid control.
   */
  getErrorMessage(control: AbstractControl | null, field: FormFieldConfig): string | null {
    if (!control || !control.errors || !control.touched) {
      return null;
    }

    const errors = control.errors;

    if (field.validation?.message) {
      return field.validation.message;
    }

    if (errors['required'] || errors['requiredTrue']) {
      return `${field.label} is required`;
    }

    if (errors['email']) {
      return 'Please enter a valid email address';
    }

    if (errors['minlength']) {
      const requiredLength = errors['minlength'].requiredLength;
      return `${field.label} must be at least ${requiredLength} characters`;
    }

    if (errors['maxlength']) {
      const requiredLength = errors['maxlength'].requiredLength;
      return `${field.label} cannot exceed ${requiredLength} characters`;
    }

    if (errors['min']) {
      return `${field.label} must be at least ${errors['min'].min}`;
    }

    if (errors['max']) {
      return `${field.label} cannot exceed ${errors['max'].max}`;
    }

    if (errors['pattern']) {
      return `${field.label} format is invalid`;
    }

    return `${field.label} is invalid`;
  }
}
