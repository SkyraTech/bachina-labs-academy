export type TableActionVariant = 'brand' | 'secondary' | 'danger' | 'ghost';

/**
 * Row or bulk action definition for dynamic data tables.
 */
export interface TableActionConfig<T = unknown> {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly variant?: TableActionVariant;
  readonly isVisible?: (row: T) => boolean;
  readonly isDisabled?: (row: T) => boolean;
  readonly execute: (row: T) => void | Promise<void>;
}
