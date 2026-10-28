import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  input,
  output,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { MediaAssetDto, PaginatedMediaAssetsResponse } from '../../models/article-media.models';
import { ArticleMediaUploadComponent } from '../article-media-upload/article-media-upload.component';

@Component({
  selector: 'app-article-media-picker',
  standalone: true,
  imports: [CommonModule, ArticleMediaUploadComponent],
  templateUrl: './article-media-picker.component.html',
  styleUrl: './article-media-picker.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleMediaPickerComponent implements OnInit {
  private readonly mediaApi = inject(ArticleMediaApiService);

  readonly selectedMediaId = input<string | null>(null);

  readonly mediaSelected = output<MediaAssetDto>();
  readonly closed = output<void>();

  readonly activeTab = signal<'library' | 'upload'>('library');
  readonly mediaItems = signal<MediaAssetDto[]>([]);
  readonly selectedAsset = signal<MediaAssetDto | null>(null);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly currentPage = signal(1);
  readonly totalPages = signal(1);
  readonly totalItems = signal(0);
  readonly limit = 12;

  ngOnInit(): void {
    this.loadMedia(1);
  }

  loadMedia(page: number): void {
    if (this.isLoading()) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.mediaApi.listMyMedia({ page, limit: this.limit }).subscribe({
      next: (res: PaginatedMediaAssetsResponse) => {
        this.isLoading.set(false);
        this.mediaItems.set(res.items);
        this.currentPage.set(res.page);
        this.totalPages.set(res.totalPages);
        this.totalItems.set(res.total);

        // Pre-select if matches initial selection or previous selection
        const targetId = this.selectedAsset()?.id || this.selectedMediaId();
        if (targetId) {
          const match = res.items.find((item) => item.id === targetId);
          if (match) {
            this.selectedAsset.set(match);
          }
        }
      },
      error: (err: unknown) => {
        this.isLoading.set(false);
        const msg = (err as { error?: { message?: string } })?.error?.message;
        this.errorMessage.set(msg || 'Failed to load media assets. Please try again.');
      },
    });
  }

  selectAsset(asset: MediaAssetDto): void {
    this.selectedAsset.set(asset);
  }

  confirmSelection(): void {
    const asset = this.selectedAsset();
    if (asset) {
      this.mediaSelected.emit(asset);
    }
  }

  onUploadCompleted(asset: MediaAssetDto): void {
    this.activeTab.set('library');
    this.selectedAsset.set(asset);
    this.loadMedia(1);
  }

  getPreviewUrl(mediaId: string): string {
    return this.mediaApi.getPrivateMediaPreviewUrl(mediaId);
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages() && page !== this.currentPage()) {
      this.loadMedia(page);
    }
  }

  closeModal(): void {
    this.closed.emit();
  }
}
