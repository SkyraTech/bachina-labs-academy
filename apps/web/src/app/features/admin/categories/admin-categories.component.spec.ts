import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { AdminCategoriesComponent } from './admin-categories.component';
import { TaxonomyApiService } from '../../../core/taxonomy/services/taxonomy-api.service';
import { AcademyDialogService } from '../../../shared/ui/dialog/services/academy-dialog.service';
import { ToastService } from '../../../shared/ui';
import { Category, PaginatedCategories } from '../../../core/taxonomy/models/taxonomy.models';

describe('AdminCategoriesComponent', () => {
  let component: AdminCategoriesComponent;
  let fixture: ComponentFixture<AdminCategoriesComponent>;
  let taxonomyApiMock: {
    getAdminCategories: ReturnType<typeof vi.fn>;
    createCategory: ReturnType<typeof vi.fn>;
    updateCategory: ReturnType<typeof vi.fn>;
    deleteCategory: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { danger: ReturnType<typeof vi.fn> };
  let toastMock: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  const mockCategories: Category[] = [
    {
      id: 'cat-1',
      name: 'Cloud Computing',
      slug: 'cloud-computing',
      description: 'Distributed cloud platforms and architectures',
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-25T10:00:00Z',
    },
    {
      id: 'cat-2',
      name: 'Database Engineering',
      slug: 'database-engineering',
      description: null,
      createdAt: '2026-10-26T10:00:00Z',
      updatedAt: '2026-10-26T10:00:00Z',
    },
  ];

  const paginatedResponse: PaginatedCategories = {
    items: mockCategories,
    total: 2,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  beforeEach(async () => {
    taxonomyApiMock = {
      getAdminCategories: vi.fn().mockReturnValue(of(paginatedResponse)),
      createCategory: vi.fn().mockReturnValue(of({ ...mockCategories[0], id: 'cat-new' })),
      updateCategory: vi.fn().mockReturnValue(of(mockCategories[0])),
      deleteCategory: vi.fn().mockReturnValue(of(void 0)),
    };

    dialogMock = {
      danger: vi.fn().mockResolvedValue(true),
    };

    toastMock = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AdminCategoriesComponent],
      providers: [
        { provide: TaxonomyApiService, useValue: taxonomyApiMock },
        { provide: AcademyDialogService, useValue: dialogMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminCategoriesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should load categories on initialization', () => {
    expect(taxonomyApiMock.getAdminCategories).toHaveBeenCalledWith(1, 20);
    expect(component.categories()).toEqual(mockCategories);
    expect(component.total()).toBe(2);
  });

  it('2. should open create form and auto-generate slug on name input', () => {
    component.openCreate();

    expect(component.formVisible()).toBe(true);
    expect(component.editingCategoryId()).toBeNull();

    component.form.get('name')?.setValue('Artificial Intelligence');
    component.onNameInput();

    expect(component.form.get('slug')?.value).toBe('artificial-intelligence');
  });

  it('3. should preserve manual slug edits when regenerate is not called', () => {
    component.openCreate();
    component.form.get('name')?.setValue('Deep Learning');
    component.onNameInput();
    expect(component.form.get('slug')?.value).toBe('deep-learning');

    component.form.get('slug')?.setValue('custom-ai-slug');
    component.onSlugEdited();

    component.form.get('name')?.setValue('Advanced Deep Learning');
    component.onNameInput();

    expect(component.form.get('slug')?.value).toBe('custom-ai-slug');

    component.regenerateSlug();
    expect(component.form.get('slug')?.value).toBe('advanced-deep-learning');
  });

  it('4. should validate slug format regex strictly', () => {
    component.openCreate();
    const slugCtrl = component.form.get('slug');

    slugCtrl?.setValue('Valid-Slug-123'); // uppercase invalid
    expect(slugCtrl?.valid).toBe(false);

    slugCtrl?.setValue('invalid_underscore');
    expect(slugCtrl?.valid).toBe(false);

    slugCtrl?.setValue('-leading-hyphen');
    expect(slugCtrl?.valid).toBe(false);

    slugCtrl?.setValue('trailing-hyphen-');
    expect(slugCtrl?.valid).toBe(false);

    slugCtrl?.setValue('valid-kebab-slug-2026');
    expect(slugCtrl?.valid).toBe(true);
  });

  it('5. should submit new category and refresh categories list', async () => {
    component.openCreate();
    component.form.setValue({
      name: 'System Design',
      slug: 'system-design',
      description: 'High level system architecture',
    });

    await component.onSave();

    expect(taxonomyApiMock.createCategory).toHaveBeenCalledWith({
      name: 'System Design',
      slug: 'system-design',
      description: 'High level system architecture',
    });
    expect(toastMock.success).toHaveBeenCalledWith('Category created successfully.');
    expect(component.formVisible()).toBe(false);
  });

  it('6. should open edit form and update existing category', async () => {
    component.openEdit(mockCategories[0]);

    expect(component.formVisible()).toBe(true);
    expect(component.editingCategoryId()).toBe('cat-1');
    expect(component.form.get('name')?.value).toBe('Cloud Computing');
    expect(component.form.get('slug')?.value).toBe('cloud-computing');

    component.form.patchValue({ name: 'Cloud & Edge Computing' });

    await component.onSave();

    expect(taxonomyApiMock.updateCategory).toHaveBeenCalledWith('cat-1', {
      name: 'Cloud & Edge Computing',
      slug: 'cloud-computing',
      description: 'Distributed cloud platforms and architectures',
    });
    expect(toastMock.success).toHaveBeenCalledWith('Category updated successfully.');
  });

  it('7. should cancel form and reset form values', () => {
    component.openEdit(mockCategories[0]);
    expect(component.formVisible()).toBe(true);

    component.cancelForm();

    expect(component.formVisible()).toBe(false);
    expect(component.editingCategoryId()).toBeNull();
  });

  it('8. should delete category when confirmed via danger dialog', async () => {
    await component.onDelete(mockCategories[0]);

    expect(dialogMock.danger).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete Category',
        confirmLabel: 'Delete Category',
      }),
    );
    expect(taxonomyApiMock.deleteCategory).toHaveBeenCalledWith('cat-1');
    expect(toastMock.success).toHaveBeenCalledWith('Category "Cloud Computing" deleted successfully.');
  });

  it('9. should abort deletion when dialog is cancelled', async () => {
    dialogMock.danger.mockResolvedValue(false);

    await component.onDelete(mockCategories[0]);

    expect(taxonomyApiMock.deleteCategory).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('10. should handle conflict error gracefully when creating duplicate slug', async () => {
    taxonomyApiMock.createCategory.mockReturnValue(
      throwError(() => new Error('Category with slug "cloud-computing" already exists.')),
    );

    component.openCreate();
    component.form.setValue({
      name: 'Cloud Computing',
      slug: 'cloud-computing',
      description: '',
    });

    await component.onSave();

    expect(toastMock.error).toHaveBeenCalledWith('Category with slug "cloud-computing" already exists.');
    expect(component.formVisible()).toBe(true);
  });

  it('11. should handle deletion conflict error gracefully and preserve existing categories', async () => {
    taxonomyApiMock.deleteCategory.mockReturnValue(
      throwError(() => new Error('Cannot delete category: Category is referenced by active articles.')),
    );

    await component.onDelete(mockCategories[0]);

    expect(taxonomyApiMock.deleteCategory).toHaveBeenCalledWith('cat-1');
    expect(toastMock.error).toHaveBeenCalledWith('Cannot delete category: Category is referenced by active articles.');
    expect(component.categories()).toHaveLength(2);
  });
});

