import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormActionConfig,
  FormFieldConfig,
  FormSectionConfig,
} from '../../models';
import { DynamicFormBuilderService } from '../../services/dynamic-form-builder.service';
import { FormFieldComponent } from '../form-field/form-field.component';

/**
 * Reusable, accessible, schema-driven dynamic form component.
 */
@Component({
  selector: 'app-dynamic-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormFieldComponent],
  templateUrl: './dynamic-form.component.html',
  styleUrl: './dynamic-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DynamicFormComponent implements OnInit {
  private readonly formBuilderService = inject(DynamicFormBuilderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly elementRef = inject(ElementRef);

  /** Flat list of field definitions (used if sections are not provided) */
  readonly fields = input<readonly FormFieldConfig[]>([]);

  /** Grouped sections of fields */
  readonly sections = input<readonly FormSectionConfig[]>([]);

  /** Action buttons (Submit, Cancel, Reset, etc.) */
  readonly actions = input<readonly FormActionConfig[]>([
    { id: 'submit', label: 'Submit', type: 'submit', variant: 'brand' },
  ]);

  /** Whether action buttons should span full width of form container */
  readonly fullWidthActions = input<boolean>(false);

  readonly loading = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly errorMessage = input<string | null>(null);
  readonly successMessage = input<string | null>(null);

  /** Emits validated, enabled form values upon valid submission */
  readonly formSubmit = output<Record<string, unknown>>();
  readonly formCancel = output<void>();
  readonly formReset = output<void>();
  readonly valueChange = output<Record<string, unknown>>();

  formGroup!: FormGroup;
  readonly submitting = signal<boolean>(false);
  readonly formValue = signal<Record<string, unknown>>({});

  /** Normalized list of sections for rendering */
  readonly normalizedSections = computed<readonly FormSectionConfig[]>(() => {
    const sec = this.sections();
    if (sec && sec.length > 0) {
      return sec;
    }
    const flds = this.fields();
    if (flds && flds.length > 0) {
      return [
        {
          id: 'default',
          fields: flds,
          columns: 12,
        },
      ];
    }
    return [];
  });

  ngOnInit(): void {
    if (this.sections() && this.sections().length > 0) {
      this.formGroup = this.formBuilderService.buildFormFromSections(this.sections());
    } else {
      this.formGroup = this.formBuilderService.buildForm(this.fields());
    }

    if (this.disabled()) {
      this.formGroup.disable();
    }

    this.formValue.set(this.formGroup.getRawValue());
    this.syncConditionalFields();

    this.formGroup.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => {
        this.formValue.set(this.formGroup.getRawValue());
        this.syncConditionalFields();
        this.valueChange.emit(val as Record<string, unknown>);
      });
  }

  /**
   * Synchronizes conditional field disabled/enabled states so hidden fields do not block validation.
   */
  private syncConditionalFields(): void {
    const currentValues = this.formGroup.getRawValue();
    for (const section of this.normalizedSections()) {
      for (const field of section.fields) {
        if (field.type === 'hidden') continue;
        if (field.visibleWhen) {
          const isVisible = field.visibleWhen(currentValues);
          const control = this.formGroup.get(field.name);
          if (control) {
            if (!isVisible && control.enabled) {
              control.disable({ emitEvent: false });
            } else if (isVisible && control.disabled && !this.disabled() && !field.disabled) {
              control.enable({ emitEvent: false });
            }
          }
        }
      }
    }
  }

  /**
   * Checks whether a field should currently be rendered based on its visibleWhen callback.
   */
  isFieldVisible(field: FormFieldConfig): boolean {
    if (field.type === 'hidden') return true;
    if (!field.visibleWhen) return true;
    return field.visibleWhen(this.formValue());
  }

  /**
   * Calculates responsive column span class for grid layout.
   */
  getColSpanClass(field: FormFieldConfig): string {
    const span = field.colSpan ?? 12;
    return `col-span-${span}`;
  }

  /**
   * Handles form submission.
   */
  onSubmit(): void {
    if (this.submitting() || this.loading() || this.disabled()) {
      return;
    }

    if (this.formGroup.invalid) {
      this.formGroup.markAllAsTouched();
      this.focusFirstInvalidField();
      return;
    }

    this.submitting.set(true);

    // Filter values to only visible fields
    const rawValue = this.formGroup.value as Record<string, unknown>;
    const sanitizedValue: Record<string, unknown> = {};

    for (const section of this.normalizedSections()) {
      for (const field of section.fields) {
        if (this.isFieldVisible(field) && field.name in rawValue) {
          sanitizedValue[field.name] = rawValue[field.name];
        }
      }
    }

    this.formSubmit.emit(sanitizedValue);
    this.submitting.set(false);
  }

  /**
   * Handles action button clicks.
   */
  handleAction(action: FormActionConfig): void {
    if (action.type === 'submit') {
      this.onSubmit();
    } else if (action.type === 'reset') {
      this.formGroup.reset();
      this.formReset.emit();
    } else if (action.type === 'cancel') {
      this.formCancel.emit();
    }
  }

  /**
   * Finds the first invalid form control and focuses its corresponding DOM input.
   */
  private focusFirstInvalidField(): void {
    const nativeEl = this.elementRef.nativeElement as HTMLElement;
    const invalidInput = nativeEl.querySelector(
      '.form-control-input.input-error, .form-control-textarea.input-error, .form-control-select.input-error, .form-checkbox.input-error',
    ) as HTMLElement | null;

    if (invalidInput) {
      invalidInput.focus();
    }
  }
}
