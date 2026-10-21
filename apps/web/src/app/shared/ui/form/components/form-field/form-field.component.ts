import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormFieldConfig, FormFieldOption } from '../../models';
import { DynamicFormBuilderService } from '../../services/dynamic-form-builder.service';

/**
 * Renders an accessible, styled form input control based on a FormFieldConfig contract.
 */
@Component({
  selector: 'app-form-field',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './form-field.component.html',
  styleUrl: './form-field.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormFieldComponent implements OnInit {
  private readonly formBuilderService = inject(DynamicFormBuilderService);

  readonly field = input.required<FormFieldConfig>();
  readonly form = input.required<FormGroup>();

  /** Resolved list of select/radio/multiselect options */
  readonly options = signal<readonly FormFieldOption[]>([]);
  readonly loadingOptions = signal<boolean>(false);

  private readonly destroyRef = inject(DestroyRef);

  /** Signal incremented on form status or value changes to trigger reactive computations in zoneless mode */
  readonly statusVersion = signal<number>(0);

  /** Password visibility toggle state for password input fields */
  readonly showPassword = signal<boolean>(false);

  /** Computed input type that accounts for password reveal */
  readonly computedInputType = computed(() => {
    if (this.field().type === 'password') {
      return this.showPassword() ? 'text' : 'password';
    }
    return this.field().type;
  });

  togglePasswordVisibility(): void {
    this.showPassword.update((visible) => !visible);
  }

  /** Active FormControl extracted from parent FormGroup */
  readonly control = computed(() => {
    return this.form().get(this.field().name) as FormControl | null;
  });

  /** Whether the field is currently invalid and touched */
  readonly isInvalid = computed(() => {
    this.statusVersion();
    const c = this.control();
    return !!(c && c.invalid && (c.touched || c.dirty));
  });

  /** User-friendly error message */
  readonly errorMessage = computed(() => {
    this.statusVersion();
    const c = this.control();
    return this.formBuilderService.getErrorMessage(c, this.field());
  });

  ngOnInit(): void {
    const ctrl = this.control();
    if (ctrl) {
      ctrl.statusChanges
        ?.pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.statusVersion.update((v) => v + 1));
      ctrl.valueChanges
        ?.pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.statusVersion.update((v) => v + 1));
    }

    this.form().statusChanges
      ?.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.statusVersion.update((v) => v + 1));
    const rawOptions = this.field().options;
    if (typeof rawOptions === 'function') {
      this.loadingOptions.set(true);
      rawOptions()
        .then((opts) => {
          this.options.set(opts);
          this.loadingOptions.set(false);
        })
        .catch(() => {
          this.loadingOptions.set(false);
        });
    } else if (Array.isArray(rawOptions)) {
      this.options.set(rawOptions);
    }
  }

  /**
   * Manually refreshes validity state (e.g. after programmatic markAsTouched)
   */
  refreshValidity(): void {
    this.statusVersion.update((v) => v + 1);
  }

  /**
   * Toggles an option for multiselect checkbox lists.
   */
  toggleMultiselect(value: unknown): void {
    const ctrl = this.control();
    if (!ctrl) return;

    const current: unknown[] = Array.isArray(ctrl.value) ? [...ctrl.value] : [];
    const index = current.indexOf(value);

    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(value);
    }

    ctrl.setValue(current);
    ctrl.markAsDirty();
    ctrl.markAsTouched();
  }

  isMultiselectSelected(value: unknown): boolean {
    const ctrl = this.control();
    if (!ctrl || !Array.isArray(ctrl.value)) return false;
    return ctrl.value.includes(value);
  }

  /**
   * Toggles a toggle/switch control.
   */
  toggleSwitch(): void {
    const ctrl = this.control();
    if (!ctrl || ctrl.disabled) return;
    ctrl.setValue(!ctrl.value);
    ctrl.markAsDirty();
    ctrl.markAsTouched();
  }
}
