export type FormActionType = 'submit' | 'cancel' | 'reset' | 'custom';
export type FormActionVariant = 'brand' | 'secondary' | 'danger' | 'ghost';

/**
 * Action button configuration for dynamic forms.
 */
export interface FormActionConfig {
  readonly id: string;
  readonly label: string;
  readonly type: FormActionType;
  readonly variant?: FormActionVariant;
  readonly icon?: string;
  readonly disabled?: boolean;
  readonly fullWidth?: boolean;
}
