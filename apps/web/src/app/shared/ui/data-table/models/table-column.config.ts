import { TemplateRef } from '@angular/core';

export type ColumnAlign = 'left' | 'center' | 'right';

/**
 * Strongly typed column configuration for dynamic data tables.
 */
export interface TableColumnConfig<T = unknown> {
  readonly field: keyof T | string;
  readonly header: string;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly align?: ColumnAlign;
  readonly width?: string;
  readonly minWidth?: string;
  readonly maxWidth?: string;
  readonly hidden?: boolean;
  /** Custom formatter function */
  readonly formatter?: (value: unknown, row: T) => string;
  /** Custom Angular template for cell rendering */
  readonly cellTemplate?: TemplateRef<{ $implicit: unknown; row: T }>;
}
