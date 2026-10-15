/**
 * Supported dynamic form field input types.
 */
export type FormFieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'toggle'
  | 'hidden';

/**
 * Option for select, multiselect, radio, and checkbox-group fields.
 */
export interface FormFieldOption<T = string | number | boolean> {
  readonly label: string;
  readonly value: T;
  readonly disabled?: boolean;
  readonly description?: string;
  readonly icon?: string;
}

/**
 * Validation constraints for form fields.
 */
export interface FormFieldValidation {
  readonly required?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string | RegExp;
  readonly customValidatorName?: string;
  readonly message?: string;
}

/**
 * Strongly typed dynamic form field configuration contract.
 */
export interface FormFieldConfig<TValue = unknown> {
  readonly name: string;
  readonly label: string;
  readonly type: FormFieldType;
  readonly defaultValue?: TValue;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly readonly?: boolean;
  readonly options?: readonly FormFieldOption[] | (() => Promise<readonly FormFieldOption[]>);
  readonly validation?: FormFieldValidation;
  /** Visible condition callback based on entire form values */
  readonly visibleWhen?: (formValue: Record<string, unknown>) => boolean;
  /** Responsive column span: 1 to 12 */
  readonly colSpan?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  readonly autocomplete?: string;
}
