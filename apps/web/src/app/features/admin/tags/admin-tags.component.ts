import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
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
import { Tag } from '../../../core/taxonomy/models/taxonomy.models';
import { AcademyDialogService } from '../../../shared/ui/dialog/services/academy-dialog.service';
import { ToastService } from '../../../shared/ui';
import { PageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { generateSlug } from '../../author/articles/components/article-create/article-create.component';

@Component({
  selector: 'app-admin-tags',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, PageHeaderComponent],
  templateUrl: './admin-tags.component.html',
  styleUrl: './admin-tags.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminTagsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly taxonomyApi = inject(TaxonomyApiService);
  private readonly dialogService = inject(AcademyDialogService);
  private readonly toast = inject(ToastService);

  readonly tags = signal<Tag[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly formVisible = signal(false);
  readonly editingTagId = signal<string | null>(null);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly limit = 20;
  readonly searchQuery = signal('');

  readonly filteredTags = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return this.tags();
    return this.tags().filter(
      (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    );
  });

  private userEditedSlug = false;

  readonly form: FormGroup = this.fb.group({
    name: [
      '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
    ],
    slug: [
      '',
      [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(120),
        Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      ],
    ],
  });

  ngOnInit(): void {
    this.loadTags();
  }

  async loadTags(page = 1): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.taxonomyApi.getAdminTags(page, this.limit),
      );
      this.tags.set(res.items);
      this.total.set(res.total);
      this.page.set(res.page);
    } catch (err: unknown) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ||
        (err instanceof Error ? err.message : 'Failed to load tags.');
      this.toast.error(msg);
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.editingTagId.set(null);
    this.userEditedSlug = false;
    this.form.reset({
      name: '',
      slug: '',
    });
    this.formVisible.set(true);
  }

  openEdit(tag: Tag): void {
    this.editingTagId.set(tag.id);
    this.userEditedSlug = true;
    this.form.patchValue({
      name: tag.name,
      slug: tag.slug,
    });
    this.formVisible.set(true);
  }

  cancelForm(): void {
    this.formVisible.set(false);
    this.editingTagId.set(null);
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
    const tagId = this.editingTagId();

    try {
      if (tagId) {
        await firstValueFrom(
          this.taxonomyApi.updateTag(tagId, {
            name: val.name.trim(),
            slug: val.slug.trim(),
          }),
        );
        this.toast.success('Tag updated successfully.');
      } else {
        await firstValueFrom(
          this.taxonomyApi.createTag({
            name: val.name.trim(),
            slug: val.slug.trim(),
          }),
        );
        this.toast.success('Tag created successfully.');
      }
      this.cancelForm();
      await this.loadTags(this.page());
    } catch (err: unknown) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ||
        (err instanceof Error ? err.message : 'Failed to save tag.');
      this.toast.error(msg);
    } finally {
      this.submitting.set(false);
    }
  }

  async onDelete(tag: Tag): Promise<void> {
    const confirmed = await this.dialogService.danger({
      title: 'Delete Tag',
      message: `Are you sure you want to permanently delete tag "#${tag.name}"? Articles using this tag will have it disassociated.`,
      confirmLabel: 'Delete Tag',
      cancelLabel: 'Cancel',
    });

    if (!confirmed) return;

    try {
      await firstValueFrom(this.taxonomyApi.deleteTag(tag.id));
      this.toast.success(`Tag "#${tag.name}" deleted successfully.`);
      await this.loadTags(this.page());
    } catch (err: unknown) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ||
        (err instanceof Error ? err.message : `Failed to delete tag "#${tag.name}".`);
      this.toast.error(msg);
    }
  }
}

