import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleMediaPickerComponent } from './article-media-picker.component';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { MediaAssetDto, PaginatedMediaAssetsResponse } from '../../models/article-media.models';

describe('ArticleMediaPickerComponent', () => {
  let component: ArticleMediaPickerComponent;
  let fixture: ComponentFixture<ArticleMediaPickerComponent>;
  let mediaApiMock: {
    listMyMedia: ReturnType<typeof vi.fn>;
    uploadMedia: ReturnType<typeof vi.fn>;
    getPrivateMediaPreviewUrl: ReturnType<typeof vi.fn>;
  };

  const mockItems: MediaAssetDto[] = [
    {
      id: 'asset-1',
      originalFilename: 'photo1.jpg',
      mimeType: 'image/jpeg',
      fileSize: 2048,
      mediaType: 'IMAGE',
      width: null,
      height: null,
      createdAt: '2026-10-26T00:00:00Z',
    },
    {
      id: 'asset-2',
      originalFilename: 'photo2.webp',
      mimeType: 'image/webp',
      fileSize: 4096,
      mediaType: 'IMAGE',
      width: null,
      height: null,
      createdAt: '2026-10-26T00:00:00Z',
    },
  ];

  beforeEach(async () => {
    mediaApiMock = {
      listMyMedia: vi.fn(),
      uploadMedia: vi.fn(),
      getPrivateMediaPreviewUrl: vi.fn((id: string) => `/api/v1/articles/media/${id}/content`),
    };

    const mockResponse: PaginatedMediaAssetsResponse = {
      items: mockItems,
      total: 2,
      page: 1,
      limit: 12,
      totalPages: 1,
    };
    mediaApiMock.listMyMedia.mockReturnValue(of(mockResponse));

    await TestBed.configureTestingModule({
      imports: [ArticleMediaPickerComponent],
      providers: [
        { provide: ArticleMediaApiService, useValue: mediaApiMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleMediaPickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load media on init', () => {
    expect(component).toBeTruthy();
    expect(mediaApiMock.listMyMedia).toHaveBeenCalledWith({ page: 1, limit: 12 });
    expect(component.mediaItems().length).toBe(2);
    expect(component.totalItems()).toBe(2);
  });

  it('should select an asset when clicked', () => {
    component.selectAsset(mockItems[1]);
    expect(component.selectedAsset()).toEqual(mockItems[1]);
  });

  it('should emit mediaSelected upon confirmation', () => {
    component.selectAsset(mockItems[0]);

    let emitted: MediaAssetDto | undefined;
    component.mediaSelected.subscribe((a) => {
      emitted = a;
    });

    component.confirmSelection();
    expect(emitted).toEqual(mockItems[0]);
  });

  it('should switch tab and refresh library on upload completed', () => {
    const newAsset: MediaAssetDto = {
      id: 'asset-3',
      originalFilename: 'new.png',
      mimeType: 'image/png',
      fileSize: 1024,
      mediaType: 'IMAGE',
      width: null,
      height: null,
      createdAt: '2026-10-26T00:00:00Z',
    };

    component.activeTab.set('upload');
    component.onUploadCompleted(newAsset);

    expect(component.activeTab()).toBe('library');
    expect(component.selectedAsset()).toEqual(newAsset);
    expect(mediaApiMock.listMyMedia).toHaveBeenCalledTimes(2);
  });

  it('should handle API errors gracefully and display message', () => {
    mediaApiMock.listMyMedia.mockReturnValue(
      throwError(() => ({ error: { message: 'Database query failed' } })),
    );

    component.loadMedia(1);

    expect(component.isLoading()).toBe(false);
    expect(component.errorMessage()).toBe('Database query failed');
  });

  it('should emit closed when modal is dismissed', () => {
    let closed = false;
    component.closed.subscribe(() => {
      closed = true;
    });

    component.closeModal();
    expect(closed).toBe(true);
  });
});
