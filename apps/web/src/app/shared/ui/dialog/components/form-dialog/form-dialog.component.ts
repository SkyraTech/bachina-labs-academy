import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormActionConfig, FormFieldConfig } from '../../../form/models';
import { DynamicFormComponent } from '../../../form/components/dynamic-form/dynamic-form.component';
import { DialogResult } from '../../models';

export interface FormDialogData {
  title: string;
  description?: string;
  fields: readonly FormFieldConfig[];
  actions?: readonly FormActionConfig[];
}

/**
 * Reusable dialog container hosting a dynamic form inside CDK overlay.
 */
@Component({
  selector: 'app-form-dialog',
  standalone: true,
  imports: [CommonModule, DynamicFormComponent],
  templateUrl: './form-dialog.component.html',
  styleUrl: './form-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormDialogComponent {
  readonly data = inject<FormDialogData>(DIALOG_DATA);
  readonly dialogRef = inject<DialogRef<DialogResult>>(DialogRef);

  onFormSubmit(values: Record<string, unknown>): void {
    this.dialogRef.close({
      confirmed: true,
      payload: values,
    });
  }

  onCancel(): void {
    this.dialogRef.close({ confirmed: false });
  }
}
