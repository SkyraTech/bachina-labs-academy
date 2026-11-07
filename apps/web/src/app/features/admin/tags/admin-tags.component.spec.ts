import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { AdminTagsComponent } from './admin-tags.component';
import { TaxonomyApiService } from '../../../core/taxonomy/services/taxonomy-api.service';
import { AcademyDialogService } from '../../../shared/ui/dialog/services/academy-dialog.service';
import { ToastService } from '../../../shared/ui';
import { Tag, PaginatedTags } from '../../../core/taxonomy/models/taxonomy.models';

describe('AdminTagsComponent', () => {
  let component: AdminTagsComponent;
  let fixture: ComponentFixture<AdminTagsComponent>;
  let taxonomyApiMock: {
    getAdminTags: ReturnType<typeof vi.fn>;
    createTag: ReturnType<typeof vi.fn>;
    updateTag: ReturnType<typeof vi.fn>;
    deleteTag: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { danger: ReturnType<typeof vi.fn> };
  let toastMock: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  const mockTags: Tag[] = [
    {
      id: 'tag-1',
      name: 'angular',
      slug: 'angular',
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-25T10:00:00Z',
    },
    {
      id: 'tag-2',
      name: 'postgresql',
      slug: 'postgresql',
      createdAt: '2026-10-26T10:00:00Z',
      updatedAt: '2026-10-26T10:00:00Z',
    },
  ];

  const paginatedResponse: PaginatedTags = {
    items: mockTags,
    total: 2,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  beforeEach(async () => {
    taxonomyApiMock = {
      getAdminTags: vi.fn().mockReturnValue(of(paginatedResponse)),
      createTag: vi.fn().mockReturnValue(of({ ...mockTags[0], id: 'tag-new' })),
      updateTag: vi.fn().mockReturnValue(of(mockTags[0])),
      deleteTag: vi.fn().mockReturnValue(of(void 0)),
    };

    dialogMock = {
      danger: vi.fn().mockResolvedValue(true),
    };

    toastMock = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AdminTagsComponent],
      providers: [
        { provide: TaxonomyApiService, useValue: taxonomyApiMock },
        { provide: AcademyDialogService, useValue: dialogMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminTagsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should load tags on initialization', () => {
    expect(taxonomyApiMock.getAdminTags).toHaveBeenCalledWith(1, 20);
    expect(component.tags()).toEqual(mockTags);
    expect(component.total()).toBe(2);
  });

  it('2. should open create form and auto-generate slug on name input', () => {
    component.openCreate();

    expect(component.formVisible()).toBe(true);
    expect(component.editingTagId()).toBeNull();

    component.form.get('name')?.setValue('Microservices Architecture');
    component.onNameInput();

    expect(component.form.get('slug')?.value).toBe('microservices-architecture');
  });

  it('3. should preserve manual slug edits when regenerate is not called', () => {
    component.openCreate();
    component.form.get('name')?.setValue('Reactive Programming');
    component.onNameInput();
    expect(component.form.get('slug')?.value).toBe('reactive-programming');

    component.form.get('slug')?.setValue('rx-prog');
    component.onSlugEdited();

    component.form.get('name')?.setValue('Advanced Reactive Programming');
    component.onNameInput();

    expect(component.form.get('slug')?.value).toBe('rx-prog');

    component.regenerateSlug();
    expect(component.form.get('slug')?.value).toBe('advanced-reactive-programming');
  });

  it('4. should validate slug format regex strictly', () => {
    component.openCreate();
    const slugCtrl = component.form.get('slug');

    slugCtrl?.setValue('Invalid-Uppercase');
    expect(slugCtrl?.valid).toBe(false);

    slugCtrl?.setValue('invalid_underscore');
    expect(slugCtrl?.valid).toBe(false);

    slugCtrl?.setValue('-leading-hyphen');
    expect(slugCtrl?.valid).toBe(false);

    slugCtrl?.setValue('trailing-hyphen-');
    expect(slugCtrl?.valid).toBe(false);

    slugCtrl?.setValue('valid-tag-slug');
    expect(slugCtrl?.valid).toBe(true);
  });

  it('5. should submit new tag and refresh tags list', async () => {
    component.openCreate();
    component.form.setValue({
      name: 'Docker',
      slug: 'docker',
    });

    await component.onSave();

    expect(taxonomyApiMock.createTag).toHaveBeenCalledWith({
      name: 'Docker',
      slug: 'docker',
    });
    expect(toastMock.success).toHaveBeenCalledWith('Tag created successfully.');
    expect(component.formVisible()).toBe(false);
  });

  it('6. should open edit form and update existing tag', async () => {
    component.openEdit(mockTags[0]);

    expect(component.formVisible()).toBe(true);
    expect(component.editingTagId()).toBe('tag-1');
    expect(component.form.get('name')?.value).toBe('angular');
    expect(component.form.get('slug')?.value).toBe('angular');

    component.form.patchValue({ name: 'Angular 22' });

    await component.onSave();

    expect(taxonomyApiMock.updateTag).toHaveBeenCalledWith('tag-1', {
      name: 'Angular 22',
      slug: 'angular',
    });
    expect(toastMock.success).toHaveBeenCalledWith('Tag updated successfully.');
  });

  it('7. should cancel form and reset form values', () => {
    component.openEdit(mockTags[0]);
    expect(component.formVisible()).toBe(true);

    component.cancelForm();

    expect(component.formVisible()).toBe(false);
    expect(component.editingTagId()).toBeNull();
  });

  it('8. should delete tag when confirmed via danger dialog', async () => {
    await component.onDelete(mockTags[0]);

    expect(dialogMock.danger).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete Tag',
        confirmLabel: 'Delete Tag',
      }),
    );
    expect(taxonomyApiMock.deleteTag).toHaveBeenCalledWith('tag-1');
    expect(toastMock.success).toHaveBeenCalledWith('Tag "#angular" deleted successfully.');
  });

  it('9. should abort deletion when dialog is cancelled', async () => {
    dialogMock.danger.mockResolvedValue(false);

    await component.onDelete(mockTags[0]);

    expect(taxonomyApiMock.deleteTag).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('10. should handle conflict error gracefully when creating duplicate slug', async () => {
    taxonomyApiMock.createTag.mockReturnValue(
      throwError(() => new Error('Tag with slug "angular" already exists.')),
    );

    component.openCreate();
    component.form.setValue({
      name: 'angular',
      slug: 'angular',
    });

    await component.onSave();

    expect(toastMock.error).toHaveBeenCalledWith('Tag with slug "angular" already exists.');
    expect(component.formVisible()).toBe(true);
  });

  it('11. should handle deletion conflict error gracefully and preserve existing tags', async () => {
    taxonomyApiMock.deleteTag.mockReturnValue(
      throwError(() => new Error('Cannot delete tag: Tag is currently locked or referenced.')),
    );

    await component.onDelete(mockTags[0]);

    expect(taxonomyApiMock.deleteTag).toHaveBeenCalledWith('tag-1');
    expect(toastMock.error).toHaveBeenCalledWith('Cannot delete tag: Tag is currently locked or referenced.');
    expect(component.tags()).toHaveLength(2);
  });

  it('12. should filter displayed tags using search query', () => {
    expect(component.filteredTags()).toHaveLength(2);

    component.searchQuery.set('postgre');
    expect(component.filteredTags()).toHaveLength(1);
    expect(component.filteredTags()[0].name).toBe('postgresql');

    component.searchQuery.set('nonexistent');
    expect(component.filteredTags()).toHaveLength(0);

    component.searchQuery.set('');
    expect(component.filteredTags()).toHaveLength(2);
  });
});

