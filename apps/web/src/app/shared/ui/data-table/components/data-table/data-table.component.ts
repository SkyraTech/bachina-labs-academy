import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  SortOrder,
  TableActionConfig,
  TableColumnConfig,
  TableQueryModel,
} from '../../models';
import { EmptyStateComponent } from '../../../feedback/empty-state.component';
import { LoadingSkeletonComponent } from '../../../loading/loading-skeleton.component';

/**
 * Reusable, accessible, generic SaaS Data Table component.
 * Supports both Client-side in-memory operations and Server-side query emissions.
 */
@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [CommonModule, FormsModule, EmptyStateComponent, LoadingSkeletonComponent],
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataTableComponent<T extends Record<string, unknown> = Record<string, unknown>> {
  /** The dataset to display */
  readonly data = input<readonly T[]>([]);

  /** Column configuration */
  readonly columns = input.required<readonly TableColumnConfig<T>[]>();

  /** Row action buttons */
  readonly actions = input<readonly TableActionConfig<T>[]>([]) ;

  /** Operating mode: client-side processing vs server-side query emitting */
  readonly mode = input<'client' | 'server'>('client');

  /** Loading indicator */
  readonly loading = input<boolean>(false);

  /** Error message if loading failed */
  readonly error = input<string | null>(null);

  /** Total records count (required in server mode) */
  readonly totalCount = input<number>(0);

  /** Active page number (1-based) */
  readonly page = input<number>(1);

  /** Rows per page */
  readonly pageSize = input<number>(10);

  /** Available options for page size dropdown */
  readonly pageSizeOptions = input<readonly number[]>([5, 10, 20, 50]);

  /** Whether search input is visible */
  readonly searchable = input<boolean>(true);

  /** Whether row selection checkboxes are enabled */
  readonly selectable = input<boolean>(false);

  readonly searchPlaceholder = input<string>('Search records...');
  readonly emptyTitle = input<string>('No records found');
  readonly emptyMessage = input<string>('No items match your criteria.');
  readonly tableTitle = input<string | null>(null);

  /** Outputs */
  readonly queryChange = output<TableQueryModel>();
  readonly selectionChange = output<readonly T[]>();
  readonly retry = output<void>();

  /** Internal reactive state */
  readonly searchQuery = signal<string>('');
  readonly sortField = signal<string | null>(null);
  readonly sortOrder = signal<SortOrder>('asc');
  private readonly internalPage = signal<number | null>(null);
  private readonly internalPageSize = signal<number | null>(null);

  readonly currentPage = computed(() => this.internalPage() ?? this.page());
  readonly currentPageSize = computed(() => this.internalPageSize() ?? this.pageSize());
  readonly selectedRows = signal<Set<T>>(new Set());

  /**
   * Filtered and sorted data for Client mode
   */
  readonly clientProcessedData = computed(() => {
    if (this.mode() === 'server') {
      return this.data();
    }

    let items = [...this.data()];
    const query = this.searchQuery().trim().toLowerCase();

    // 1. Search Filter
    if (query) {
      items = items.filter((row) => {
        return this.columns().some((col) => {
          if (col.hidden) return false;
          const val = row[col.field as string];
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(query);
        });
      });
    }

    // 2. Sort
    const field = this.sortField();
    const order = this.sortOrder();
    if (field) {
      items.sort((a, b) => {
        const valA = a[field];
        const valB = b[field];

        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        const comparison = valA < valB ? -1 : 1;
        return order === 'asc' ? comparison : -comparison;
      });
    }

    return items;
  });

  /** Total records count across client and server modes */
  readonly totalRecords = computed(() => {
    if (this.mode() === 'server') {
      return this.totalCount();
    }
    return this.clientProcessedData().length;
  });

  /** Total number of pages */
  readonly totalPages = computed(() => {
    const total = this.totalRecords();
    const size = this.currentPageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  /** Rows to display on current page */
  readonly displayRows = computed(() => {
    if (this.mode() === 'server') {
      return this.data();
    }

    const items = this.clientProcessedData();
    const page = Math.min(this.currentPage(), this.totalPages());
    const size = this.currentPageSize();
    const start = (page - 1) * size;
    return items.slice(start, start + size);
  });

  /** Start record index for pagination footer (1-based) */
  readonly startRecord = computed(() => {
    if (this.totalRecords() === 0) return 0;
    return (this.currentPage() - 1) * this.currentPageSize() + 1;
  });

  /** End record index for pagination footer */
  readonly endRecord = computed(() => {
    const end = this.currentPage() * this.currentPageSize();
    return Math.min(end, this.totalRecords());
  });

  /** Whether all rows on current page are selected */
  readonly areAllCurrentRowsSelected = computed(() => {
    const rows = this.displayRows();
    if (rows.length === 0) return false;
    const selected = this.selectedRows();
    return rows.every((row) => selected.has(row));
  });

  /**
   * Sort column click handler
   */
  onSort(column: TableColumnConfig<T>): void {
    if (!column.sortable) return;

    const field = String(column.field);
    if (this.sortField() === field) {
      if (this.sortOrder() === 'asc') {
        this.sortOrder.set('desc');
      } else {
        // Reset sort
        this.sortField.set(null);
        this.sortOrder.set('asc');
      }
    } else {
      this.sortField.set(field);
      this.sortOrder.set('asc');
    }

    if (this.mode() === 'server') {
      this.emitQueryChange();
    }
  }

  /**
   * Search input handler
   */
  onSearchChange(term: string): void {
    this.searchQuery.set(term);
    this.internalPage.set(1);

    if (this.mode() === 'server') {
      this.emitQueryChange();
    }
  }

  /**
   * Page change handler
   */
  goToPage(page: number): void {
    const clamped = Math.max(1, Math.min(page, this.totalPages()));
    if (clamped !== this.currentPage()) {
      this.internalPage.set(clamped);
      if (this.mode() === 'server') {
        this.emitQueryChange();
      }
    }
  }

  /**
   * Page size change handler
   */
  onPageSizeChange(newSize: number): void {
    this.internalPageSize.set(newSize);
    this.internalPage.set(1);
    if (this.mode() === 'server') {
      this.emitQueryChange();
    }
  }

  /**
   * Toggle row selection
   */
  toggleRowSelection(row: T): void {
    const current = new Set(this.selectedRows());
    if (current.has(row)) {
      current.delete(row);
    } else {
      current.add(row);
    }
    this.selectedRows.set(current);
    this.selectionChange.emit(Array.from(current));
  }

  isRowSelected(row: T): boolean {
    return this.selectedRows().has(row);
  }

  /**
   * Toggle select all rows on current page
   */
  toggleSelectAll(): void {
    const current = new Set(this.selectedRows());
    const rows = this.displayRows();

    if (this.areAllCurrentRowsSelected()) {
      for (const row of rows) {
        current.delete(row);
      }
    } else {
      for (const row of rows) {
        current.add(row);
      }
    }

    this.selectedRows.set(current);
    this.selectionChange.emit(Array.from(current));
  }

  /**
   * Cell display helper
   */
  getCellValue(row: T, column: TableColumnConfig<T>): string {
    const val = row[column.field as string];
    if (column.formatter) {
      return column.formatter(val, row);
    }
    if (val === null || val === undefined) {
      return '—';
    }
    return String(val);
  }

  /**
   * Helper to check if row action is visible
   */
  isActionVisible(action: TableActionConfig<T>, row: T): boolean {
    return action.isVisible ? action.isVisible(row) : true;
  }

  /**
   * Helper to check if row action is disabled
   */
  isActionDisabled(action: TableActionConfig<T>, row: T): boolean {
    return action.isDisabled ? action.isDisabled(row) : false;
  }

  /**
   * Executes row action
   */
  executeAction(action: TableActionConfig<T>, row: T, event: Event): void {
    event.stopPropagation();
    if (!this.isActionDisabled(action, row)) {
      action.execute(row);
    }
  }

  /**
   * Emits query change event in server mode
   */
  private emitQueryChange(): void {
    this.queryChange.emit({
      page: this.currentPage(),
      pageSize: this.currentPageSize(),
      sortField: this.sortField() ?? undefined,
      sortOrder: this.sortField() ? this.sortOrder() : undefined,
      search: this.searchQuery().trim() || undefined,
    });
  }
}
