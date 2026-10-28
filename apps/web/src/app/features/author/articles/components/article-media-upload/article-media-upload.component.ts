import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { MediaAssetDto } from '../../models/article-media.models';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Component({
  selector: 'app-article-media-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './article-media-upload.component.html',
  styleUrl: './article-media-upload.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleMediaUploadComponent {
  private readonly mediaApi = inject(ArticleMediaApiService);

  readonly uploaded = output<MediaAssetDto>();
  readonly cancelled = output<void>();

  readonly selectedFile = signal<File | null>(null);
  readonly isUploading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.errorMessage.set(null);
    this.successMessage.set(null);

    if (!input.files || input.files.length === 0) {
      this.selectedFile.set(null);
      return;
    }

    const file = input.files[0];

    if (!ACCEPTED_TYPES.includes(file.type.toLowerCase())) {
      this.errorMessage.set('Unsupported image format. Allowed formats: JPEG, PNG, WebP.');
      this.selectedFile.set(null);
      input.value = '';
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      this.errorMessage.set('File is too large. Maximum allowed size is 10 MiB.');
      this.selectedFile.set(null);
      input.value = '';
      return;
    }

    if (file.size === 0) {
      this.errorMessage.set('File is empty.');
      this.selectedFile.set(null);
      input.value = '';
      return;
    }

    this.selectedFile.set(file);
  }

  clearSelection(): void {
    this.selectedFile.set(null);
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  upload(): void {
    const file = this.selectedFile();
    if (!file || this.isUploading()) {
      return;
    }

    this.isUploading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.mediaApi.uploadMedia(file).subscribe({
      next: (asset) => {
        this.isUploading.set(false);
        this.successMessage.set(`Successfully uploaded "${asset.originalFilename}"`);
        this.selectedFile.set(null);
        this.uploaded.emit(asset);
      },
      error: (err: unknown) => {
        this.isUploading.set(false);
        const backendMessage = (err as { error?: { message?: string } })?.error?.message;
        this.errorMessage.set(backendMessage || 'Image upload failed. Please try again.');
      },
    });
  }

  cancelUpload(): void {
    this.clearSelection();
    this.cancelled.emit();
  }
}
