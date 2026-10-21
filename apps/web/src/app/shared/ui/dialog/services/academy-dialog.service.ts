import { ComponentType } from '@angular/cdk/portal';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DialogConfig, DialogResult } from '../models';
import { ConfirmDialogComponent } from '../components/confirm-dialog/confirm-dialog.component';

/**
 * Enterprise Dialog and Modal Service powered by Angular CDK Dialog.
 * Provides accessible, focus-trapped confirmation, alert, and custom dialogs.
 */
@Injectable({
  providedIn: 'root',
})
export class AcademyDialogService {
  private readonly cdkDialog = inject(Dialog);

  /**
   * Opens a standard confirmation dialog. Returns Promise resolving to boolean.
   */
  async confirm(config: DialogConfig): Promise<boolean> {
    const dialogRef = this.cdkDialog.open<DialogResult, DialogConfig>(ConfirmDialogComponent, {
      data: {
        ...config,
        type: config.type ?? 'confirm',
        confirmLabel: config.confirmLabel ?? 'Confirm',
        cancelLabel: config.cancelLabel ?? 'Cancel',
      },
      disableClose: !(config.dismissableMask ?? true),
      panelClass: 'academy-dialog-panel',
      backdropClass: 'academy-dialog-backdrop',
      ariaLabelledBy: 'dialog-title',
      ariaDescribedBy: 'dialog-description',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });

    const result = await firstValueFrom(dialogRef.closed);
    return result?.confirmed ?? false;
  }

  /**
   * Opens a destructive confirmation dialog with danger/red styling.
   */
  async danger(config: DialogConfig): Promise<boolean> {
    return this.confirm({
      ...config,
      type: 'danger',
      destructive: true,
      confirmLabel: config.confirmLabel ?? 'Delete',
    });
  }

  /**
   * Opens an informational notification dialog with single OK button.
   */
  async info(config: DialogConfig): Promise<void> {
    const dialogRef = this.cdkDialog.open<DialogResult, DialogConfig>(ConfirmDialogComponent, {
      data: {
        ...config,
        type: 'info',
        confirmLabel: config.confirmLabel ?? 'OK',
        cancelLabel: '', // no cancel button for info
      },
      disableClose: !(config.dismissableMask ?? true),
      panelClass: 'academy-dialog-panel',
      backdropClass: 'academy-dialog-backdrop',
      ariaLabelledBy: 'dialog-title',
      ariaDescribedBy: 'dialog-description',
    });

    await firstValueFrom(dialogRef.closed);
  }

  /**
   * Opens any custom standalone component in an accessible dialog container.
   */
  open<TResult = unknown, TData = unknown>(
    component: ComponentType<unknown>,
    config?: { data?: TData; width?: string; disableClose?: boolean },
  ): DialogRef<TResult> {
    return this.cdkDialog.open<TResult, TData>(component, {
      data: config?.data,
      width: config?.width ?? '560px',
      disableClose: config?.disableClose ?? false,
      panelClass: 'academy-dialog-panel',
      backdropClass: 'academy-dialog-backdrop',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
  }
}
