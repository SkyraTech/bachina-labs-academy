import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ArticleEditorStateService } from '../../services/article-editor-state.service';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { TypographyPreset } from '../../models/article.models';
import { MediaAssetDto } from '../../models/article-media.models';
import { generateSlug } from '../article-create/article-create.component';
import { ArticleMediaPickerComponent } from '../article-media-picker/article-media-picker.component';

@Component({
  selector: 'app-article-metadata-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ArticleMediaPickerComponent],
  templateUrl: './article-metadata-editor.component.html',
  styleUrl: './article-metadata-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleMetadataEditorComponent {
  readonly state = inject(ArticleEditorStateService);
  private readonly fb = inject(FormBuilder);
  private readonly mediaApi = inject(ArticleMediaApiService);

  readonly isDirty = signal(false);
  readonly coverMediaId = signal<string | null>(null);
  readonly isPickerOpen = signal(false);

  readonly presets: { value: TypographyPreset; label: string; hint: string }[] = [
    { value: 'MODERN_SANS', label: 'Modern Sans', hint: 'Inter' },
    { value: 'EDITORIAL_SERIF', label: 'Editorial Serif', hint: 'Serif' },
    { value: 'TECHNICAL_MINIMAL', label: 'Technical Minimal', hint: 'JetBrains Mono' },
  ];

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

  constructor() {
    // Synchronize form when authoritative article state changes
    effect(() => {
      const art = this.state.article();
      if (art && !this.isDirty()) {
        this.form.patchValue(
          {
            title: art.title,
            draftSlug: art.draftSlug,
            summary: art.summary || '',
            typographyPreset: art.typographyPreset,
          },
          { emitEvent: false },
        );
        this.coverMediaId.set(art.coverMediaId);
      }
    });

    this.form.valueChanges.subscribe(() => {
      this.recalculateDirty();
    });
  }

  private recalculateDirty(): void {
    const art = this.state.article();
    if (!art) return;

    const currentVal = this.form.value;
    const dirty =
      currentVal.title !== art.title ||
      currentVal.draftSlug !== art.draftSlug ||
      (currentVal.summary || '') !== (art.summary || '') ||
      currentVal.typographyPreset !== art.typographyPreset ||
      this.coverMediaId() !== art.coverMediaId;

    this.isDirty.set(dirty);
    if (dirty) {
      this.state.markDirty();
    }
  }

  isFieldInvalid(name: string): boolean {
    const field = this.form.get(name);
    return !!field && field.invalid && (field.dirty || field.touched);
  }

  regenerateSlug(): void {
    const titleVal = this.form.get('title')?.value || '';
    const slug = generateSlug(titleVal);
    this.form.get('draftSlug')?.setValue(slug);
  }

  openMediaPicker(): void {
    this.isPickerOpen.set(true);
  }

  closeMediaPicker(): void {
    this.isPickerOpen.set(false);
  }

  onCoverSelected(asset: MediaAssetDto): void {
    this.coverMediaId.set(asset.id);
    this.isPickerOpen.set(false);
    this.recalculateDirty();
  }

  removeCover(): void {
    this.coverMediaId.set(null);
    this.recalculateDirty();
  }

  getCoverPreviewUrl(): string | null {
    const id = this.coverMediaId();
    return id ? this.mediaApi.getPrivateMediaPreviewUrl(id) : null;
  }

  async onSave(): Promise<void> {
    if (this.form.invalid || !this.isDirty()) return;

    const val = this.form.value;
    const success = await this.state.updateMetadata({
      title: val.title.trim(),
      draftSlug: val.draftSlug.trim(),
      summary: val.summary?.trim() || null,
      typographyPreset: val.typographyPreset,
      coverMediaId: this.coverMediaId(),
    });

    if (success) {
      this.isDirty.set(false);
    }
  }
}
