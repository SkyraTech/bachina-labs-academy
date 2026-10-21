import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { DataTableComponent } from './data-table.component';
import { TableColumnConfig, TableQueryModel } from '../../models';

interface TestUser extends Record<string, unknown> {
  id: string;
  name: string;
  role: string;
}

describe('DataTableComponent', () => {
  let component: DataTableComponent<TestUser>;
  let fixture: ComponentFixture<DataTableComponent<TestUser>>;

  const mockColumns: TableColumnConfig<TestUser>[] = [
    { field: 'name', header: 'Name', sortable: true },
    { field: 'role', header: 'Role', sortable: true },
  ];

  const mockData: TestUser[] = [
    { id: '1', name: 'Alice Smith', role: 'Architect' },
    { id: '2', name: 'Bob Jones', role: 'Engineer' },
    { id: '3', name: 'Charlie Brown', role: 'Author' },
    { id: '4', name: 'Diana Prince', role: 'Lead' },
    { id: '5', name: 'Evan Wright', role: 'Reviewer' },
    { id: '6', name: 'Fiona Gallagher', role: 'Editor' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataTableComponent, FormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(DataTableComponent<TestUser>);
    component = fixture.componentInstance;
  });

  it('should render columns and rows in client mode', () => {
    fixture.componentRef.setInput('columns', mockColumns);
    fixture.componentRef.setInput('data', mockData);
    fixture.componentRef.setInput('pageSize', 5);
    fixture.detectChanges();

    expect(component.totalRecords()).toBe(6);
    expect(component.totalPages()).toBe(2);
    expect(component.displayRows().length).toBe(5);
  });

  it('should filter rows on search in client mode', () => {
    fixture.componentRef.setInput('columns', mockColumns);
    fixture.componentRef.setInput('data', mockData);
    fixture.detectChanges();

    component.onSearchChange('alice');
    fixture.detectChanges();

    expect(component.displayRows().length).toBe(1);
    expect(component.displayRows()[0].name).toBe('Alice Smith');
  });

  it('should sort rows ascending and descending in client mode', () => {
    fixture.componentRef.setInput('columns', mockColumns);
    fixture.componentRef.setInput('data', mockData);
    fixture.detectChanges();

    // Sort name asc
    component.onSort(mockColumns[0]);
    expect(component.sortField()).toBe('name');
    expect(component.sortOrder()).toBe('asc');
    expect(component.displayRows()[0].name).toBe('Alice Smith');

    // Sort name desc
    component.onSort(mockColumns[0]);
    expect(component.sortField()).toBe('name');
    expect(component.sortOrder()).toBe('desc');
    expect(component.displayRows()[0].name).toBe('Fiona Gallagher');
  });

  it('should emit queryChange in server mode when search or page changes', () => {
    fixture.componentRef.setInput('columns', mockColumns);
    fixture.componentRef.setInput('data', mockData.slice(0, 5));
    fixture.componentRef.setInput('totalCount', 6);
    fixture.componentRef.setInput('mode', 'server');
    fixture.detectChanges();

    let emittedQuery: TableQueryModel | undefined;
    component.queryChange.subscribe((q: TableQueryModel) => {
      emittedQuery = q;
    });

    component.onSearchChange('Engineer');

    expect(emittedQuery).toBeTruthy();
    expect(emittedQuery?.search).toBe('Engineer');
    expect(emittedQuery?.page).toBe(1);
  });

  it('should support row selection and toggle all', () => {
    fixture.componentRef.setInput('columns', mockColumns);
    fixture.componentRef.setInput('data', mockData);
    fixture.componentRef.setInput('selectable', true);
    fixture.detectChanges();

    let selected: readonly TestUser[] = [];
    component.selectionChange.subscribe((s) => {
      selected = s;
    });

    // Select first row
    component.toggleRowSelection(mockData[0]);
    expect(selected.length).toBe(1);
    expect(selected[0].id).toBe('1');

    // Toggle select all on current page
    component.toggleSelectAll();
    expect(component.areAllCurrentRowsSelected()).toBe(true);
  });
});
