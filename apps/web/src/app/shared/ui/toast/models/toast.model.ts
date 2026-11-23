export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface ToastMessage {
  readonly id: string;
  readonly type: ToastType;
  readonly message: string;
  readonly title?: string;
  readonly duration?: number;
  readonly createdAt: number;
  readonly action?: ToastAction;
}
