import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleMediaUploadComponent } from './article-media-upload.component';
import { ArticleMediaApiService } from '../../services/article-media-api.service';
import { MediaAssetDto } from '../../models/article-media.models';

describe('ArticleMediaUploadComponent', () => {
  let component: ArticleMediaUploadComponent;
  let fixture: ComponentFixture<ArticleMediaUploadComponent>;
  let mediaApiMock: {
    uploadMedia: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mediaApiMock = {
      uploadMedia: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleMediaUploadComponent],
      providers: [
        { provide: ArticleMediaApiService, useValue: mediaApiMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleMediaUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should reject unsupported MIME types on file selection', () => {
    const fakeFile = new File(['data'], 'doc.pdf', { type: 'application/pdf' });
    const event = {
      target: {
        files: [fakeFile],
        value: 'doc.pdf',
      },
    } as unknown as Event;

    component.onFileSelected(event);

    expect(component.selectedFile()).toBeNull();
    expect(component.errorMessage()).toContain('Unsupported image format');
  });

  it('should reject oversized files (> 10 MiB)', () => {
    const bigFile = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 11 * 1024 * 1024 });

    const event = {
      target: {
        files: [bigFile],
        value: 'big.png',
      },
    } as unknown as Event;

    component.onFileSelected(event);

    expect(component.selectedFile()).toBeNull();
    expect(component.errorMessage()).toContain('too large');
  });

  it('should accept valid PNG file', () => {
    const validFile = new File(['valid'], 'sample.png', { type: 'image/png' });
    Object.defineProperty(validFile, 'size', { value: 1024 });

    const event = {
      target: {
        files: [validFile],
        value: 'sample.png',
      },
    } as unknown as Event;

    component.onFileSelected(event);

    expect(component.selectedFile()).toBe(validFile);
    expect(component.errorMessage()).toBeNull();
  });

  it('should emit uploaded event and update state upon successful upload', () => {
    const validFile = new File(['valid'], 'sample.png', { type: 'image/png' });
    Object.defineProperty(validFile, 'size', { value: 1024 });
    component.selectedFile.set(validFile);

    const mockResponse: MediaAssetDto = {
      id: 'media-999',
      originalFilename: 'sample.png',
      mimeType: 'image/png',
      fileSize: 1024,
      mediaType: 'IMAGE',
      width: null,
      height: null,
      createdAt: '2026-10-26T00:00:00Z',
    };
    mediaApiMock.uploadMedia.mockReturnValue(of(mockResponse));

    let emittedAsset: MediaAssetDto | undefined;
    component.uploaded.subscribe((asset) => {
      emittedAsset = asset;
    });

    component.upload();

    expect(mediaApiMock.uploadMedia).toHaveBeenCalledWith(validFile);
    expect(component.isUploading()).toBe(false);
    expect(component.selectedFile()).toBeNull();
    expect(component.successMessage()).toContain('sample.png');
    expect(emittedAsset).toEqual(mockResponse);
  });

  it('should display error message on upload failure and allow retry', () => {
    const validFile = new File(['valid'], 'sample.png', { type: 'image/png' });
    component.selectedFile.set(validFile);

    mediaApiMock.uploadMedia.mockReturnValue(
      throwError(() => ({ error: { message: 'Corrupt image bytes' } })),
    );

    component.upload();

    expect(component.isUploading()).toBe(false);
    expect(component.errorMessage()).toBe('Corrupt image bytes');
    expect(component.selectedFile()).toBe(validFile); // still available to retry
  });

  it('should prevent double submission while uploading', () => {
    component.isUploading.set(true);
    component.upload();

    expect(mediaApiMock.uploadMedia).not.toHaveBeenCalled();
  });

  it('should emit cancelled event on cancel', () => {
    let cancelled = false;
    component.cancelled.subscribe(() => {
      cancelled = true;
    });

    component.cancelUpload();

    expect(cancelled).toBe(true);
  });
});
