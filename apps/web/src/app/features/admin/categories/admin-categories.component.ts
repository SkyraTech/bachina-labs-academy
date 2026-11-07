import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TaxonomyApiService } from '../../../core/taxonomy/services/taxonomy-api.service';
import { Category } from '../../../core/taxonomy/models/taxonomy.models';
import { AcademyDialogService } from '../../../shared/ui/dialog/services/academy-dialog.service';
import { ToastService } from '../../../shared/ui';
import { PageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { generateSlug } from '../../author/articles/components/article-create/article-create.component';

@Component({
  selector: 'app-admin-categories',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, PageHeaderComponent],
  templateUrl: './admin-categories.component.html',
  styleUrl: './admin-categories.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCategoriesComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly taxonomyApi = inject(TaxonomyApiService);
  private readonly dialogService = inject(AcademyDialogService);
  private readonly toast = inject(ToastService);

  readonly categories = signal<Category[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly formVisible = signal(false);
  readonly editingCategoryId = signal<string | null>(null);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly limit = 20;

  private userEditedSlug = false;

  readonly form: FormGroup = this.fb.group({
    name: [
      '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(120)],
    ],
    slug: [
      '',
      [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(160),
        Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      ],
    ],
    description: ['', [Validators.maxLength(500)]],
  });

  ngOnInit(): void {
    this.loadCategories();
  }

  async loadCategories(page = 1): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.taxonomyApi.getAdminCategories(page, this.limit),
      );
      this.categories.set(res.items);
      this.total.set(res.total);
      this.page.set(res.page);
    } catch (err: unknown) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ||
        (err instanceof Error ? err.message : 'Failed to load categories.');
      this.toast.error(msg);
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.editingCategoryId.set(null);
    this.userEditedSlug = false;
    this.form.reset({
      name: '',
      slug: '',
      description: '',
    });
    this.formVisible.set(true);
  }

  openEdit(cat: Category): void {
    this.editingCategoryId.set(cat.id);
    this.userEditedSlug = true;
    this.form.patchValue({
      name: cat.name,
      slug: cat.slug,
      description: cat.description ?? '',
    });
    this.formVisible.set(true);
  }

  cancelForm(): void {
    this.formVisible.set(false);
    this.editingCategoryId.set(null);
    this.form.reset();
  }

  onNameInput(): void {
    if (!this.userEditedSlug) {
      const nameVal = this.form.get('name')?.value || '';
      const autoSlug = generateSlug(nameVal);
      this.form.get('slug')?.setValue(autoSlug);
    }
  }

  onSlugEdited(): void {
    this.userEditedSlug = true;
  }

  regenerateSlug(): void {
    const nameVal = this.form.get('name')?.value || '';
    const autoSlug = generateSlug(nameVal);
    this.form.get('slug')?.setValue(autoSlug);
    this.userEditedSlug = false;
  }

  isFieldInvalid(name: string): boolean {
    const ctrl = this.form.get(name);
    return !!ctrl && ctrl.invalid && (ctrl.dirty || ctrl.touched);
  }

  async onSave(): Promise<void> {
    if (this.form.invalid || this.submitting()) return;

    this.submitting.set(true);
    const val = this.form.value;
    const catId = this.editingCategoryId();

    try {
      if (catId) {
        await firstValueFrom(
          this.taxonomyApi.updateCategory(catId, {
            name: val.name.trim(),
            slug: val.slug.trim(),
            description: val.description?.trim() || null,
          }),
        );
        this.toast.success('Category updated successfully.');
      } else {
        await firstValueFrom(
          this.taxonomyApi.createCategory({
            name: val.name.trim(),
            slug: val.slug.trim(),
            description: val.description?.trim() || undefined,
          }),
        );
        this.toast.success('Category created successfully.');
      }
      this.cancelForm();
      await this.loadCategories(this.page());
    } catch (err: unknown) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ||
        (err instanceof Error ? err.message : 'Failed to save category.');
      this.toast.error(msg);
    } finally {
      this.submitting.set(false);
    }
  }

  async onDelete(cat: Category): Promise<void> {
    const confirmed = await this.dialogService.danger({
      title: 'Delete Category',
      message: `Are you sure you want to permanently delete category "${cat.name}"? Articles linked to this category may be affected.`,
      confirmLabel: 'Delete Category',
      cancelLabel: 'Cancel',
    });

    if (!confirmed) return;

    try {
      await firstValueFrom(this.taxonomyApi.deleteCategory(cat.id));
      this.toast.success(`Category "${cat.name}" deleted successfully.`);
      await this.loadCategories(this.page());
    } catch (err: unknown) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ||
        (err instanceof Error
          ? err.message
          : `Failed to delete category "${cat.name}".`);
      this.toast.error(msg);
    }
  }
}

