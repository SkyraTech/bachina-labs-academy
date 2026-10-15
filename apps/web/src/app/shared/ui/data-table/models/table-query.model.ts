export type SortOrder = 'asc' | 'desc';

/**
 * Standard pagination, sorting, and filtering query parameters for tables.
 */
export interface TableQueryModel {
  readonly page: number;
  readonly pageSize: number;
  readonly sortField?: string;
  readonly sortOrder?: SortOrder;
  readonly search?: string;
  readonly filters?: Record<string, unknown>;
}
