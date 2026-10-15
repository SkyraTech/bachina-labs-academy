export type DialogType = 'info' | 'confirm' | 'danger' | 'custom';

/**
 * Configuration options for shared confirmation and action dialogs.
 */
export interface DialogConfig {
  readonly title: string;
  readonly message: string;
  readonly type?: DialogType;
  readonly icon?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly width?: string;
  readonly closable?: boolean;
  readonly dismissableMask?: boolean;
}

/**
 * Result returned from a dialog action.
 */
export interface DialogResult {
  readonly confirmed: boolean;
  readonly payload?: unknown;
}
