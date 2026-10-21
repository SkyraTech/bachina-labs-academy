import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DialogConfig, DialogResult } from '../../models';

/**
 * Accessible modal dialog component for confirmations and alerts.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  readonly data = inject<DialogConfig>(DIALOG_DATA);
  readonly dialogRef = inject<DialogRef<DialogResult>>(DialogRef);

  readonly loading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  @HostListener('keydown.escape')
  onEscape(): void {
    if (!this.loading() && (this.data.closable ?? true)) {
      this.onCancel();
    }
  }

  async onConfirm(): Promise<void> {
    if (this.loading()) return;

    if (this.data.onConfirm) {
      this.loading.set(true);
      this.errorMessage.set(null);
      try {
        const res = await this.data.onConfirm();
        if (res === false) {
          this.errorMessage.set('Action could not be completed.');
          this.loading.set(false);
          return;
        }
        this.dialogRef.close({ confirmed: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Action failed. Please try again.';
        this.errorMessage.set(msg);
        this.loading.set(false);
      }
    } else {
      this.dialogRef.close({ confirmed: true });
    }
  }

  onCancel(): void {
    if (!this.loading()) {
      this.dialogRef.close({ confirmed: false });
    }
  }
}
