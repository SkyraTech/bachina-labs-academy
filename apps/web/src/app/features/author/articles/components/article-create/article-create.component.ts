import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PageHeaderComponent } from '../../../../../shared/ui/page-header/page-header.component';
import { ArticleEditorApiService } from '../../services/article-editor-api.service';
import { ToastService } from '../../../../../shared/ui';
import { TypographyPreset } from '../../models/article.models';

import { ArticleCategorySelectorComponent } from '../article-category-selector/article-category-selector.component';
import { ArticleTagSelectorComponent } from '../article-tag-selector/article-tag-selector.component';

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Component({
  selector: 'app-article-create',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    PageHeaderComponent,
    ArticleCategorySelectorComponent,
    ArticleTagSelectorComponent,
  ],
  templateUrl: './article-create.component.html',
  styleUrl: './article-create.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleCreateComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ArticleEditorApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly submitting = signal(false);
  readonly categoryId = signal<string | null>(null);
  readonly tagIds = signal<string[]>([]);
  private userEditedSlug = false;

  readonly form: FormGroup = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
    draftSlug: [
      '',
      [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(280),
        Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      ],
    ],
    summary: ['', [Validators.maxLength(500)]],
    typographyPreset: ['MODERN_SANS' as TypographyPreset, [Validators.required]],
  });

  onTitleInput(): void {
    if (!this.userEditedSlug) {
      const titleVal = this.form.get('title')?.value || '';
      const autoSlug = generateSlug(titleVal);
      this.form.get('draftSlug')?.setValue(autoSlug);
    }
  }

  regenerateSlug(): void {
    const titleVal = this.form.get('title')?.value || '';
    const autoSlug = generateSlug(titleVal);
    this.form.get('draftSlug')?.setValue(autoSlug);
    this.userEditedSlug = false;
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.form.get(fieldName);
    return !!field && field.invalid && (field.dirty || field.touched);
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.submitting()) return;

    this.submitting.set(true);

    const val = this.form.value;
    try {
      const created = await firstValueFrom(
        this.api.createDraft({
          title: val.title.trim(),
          draftSlug: val.draftSlug.trim(),
          summary: val.summary?.trim() || null,
          typographyPreset: val.typographyPreset,
          categoryId: this.categoryId(),
          tagIds: this.tagIds(),
        }),
      );

      this.toast.success('Draft article created successfully.');
      this.router.navigate(['/author/articles', created.id, 'edit']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create article draft.';
      this.toast.error(msg);
      this.submitting.set(false);
    }
  }
}
