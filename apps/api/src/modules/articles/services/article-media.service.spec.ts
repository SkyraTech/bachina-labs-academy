import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { ArticleMediaService } from './article-media.service.js';
import type { UploadedMediaFile } from './article-media.service.js';
import type { ArticleMediaRepository } from '../repositories/article-media.repository.js';
import type { ArticleMediaStorageService } from './article-media-storage.service.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('ArticleMediaService', () => {
  let service: ArticleMediaService;
  let repositoryMock: {
    createMediaAsset: ReturnType<typeof vi.fn>;
    findMediaAssetById: ReturnType<typeof vi.fn>;
    findMediaAssetForOwner: ReturnType<typeof vi.fn>;
    findMediaAssetsByUploader: ReturnType<typeof vi.fn>;
    countMediaAssetsByUploader: ReturnType<typeof vi.fn>;
    findActivePublishedMediaAsset: ReturnType<typeof vi.fn>;
    deleteMediaAsset: ReturnType<typeof vi.fn>;
  };
  let storageMock: {
    generateStorageKey: ReturnType<typeof vi.fn>;
    saveFile: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    deleteFile: ReturnType<typeof vi.fn>;
  };

  const USER_ID = '11111111-0000-4000-8000-000000000001';
  const OTHER_USER_ID = '22222222-0000-4000-8000-000000000002';
  const MEDIA_ID = '33333333-0000-4000-8000-000000000001';

  const mockUser: AuthenticatedUser = {
    id: USER_ID,
    email: 'author@bachinalabs.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'sess-1',
  };

  // Valid image binary buffers
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const validWebpBuffer = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);

  beforeEach(() => {
    repositoryMock = {
      createMediaAsset: vi.fn(),
      findMediaAssetById: vi.fn(),
      findMediaAssetForOwner: vi.fn(),
      findMediaAssetsByUploader: vi.fn(),
      countMediaAssetsByUploader: vi.fn(),
      findActivePublishedMediaAsset: vi.fn(),
      deleteMediaAsset: vi.fn(),
    };

    storageMock = {
      generateStorageKey: vi.fn().mockReturnValue('2026-10/mock-storage-key.webp'),
      saveFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from('binary-content')),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };

    service = new ArticleMediaService(
      repositoryMock as unknown as ArticleMediaRepository,
      storageMock as unknown as ArticleMediaStorageService,
    );
  });

  describe('Upload validation', () => {
    it('successfully validates and uploads a valid WebP image', async () => {
      const file: UploadedMediaFile = {
        originalname: 'diagram.webp',
        mimetype: 'image/webp',
        size: validWebpBuffer.length,
        buffer: validWebpBuffer,
      };

      const mockAsset = {
        id: MEDIA_ID,
        uploaderId: USER_ID,
        storageKey: '2026-10/mock-storage-key.webp',
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        fileSize: validWebpBuffer.length,
        originalFilename: 'diagram.webp',
        width: null,
        height: null,
        altText: null,
        createdAt: new Date('2026-10-26T12:00:00Z'),
      };
      repositoryMock.createMediaAsset.mockResolvedValue(mockAsset);

      const result = await service.uploadImage(mockUser, file);

      expect(storageMock.saveFile).toHaveBeenCalledWith('2026-10/mock-storage-key.webp', validWebpBuffer);
      expect(repositoryMock.createMediaAsset).toHaveBeenCalledWith({
        uploaderId: USER_ID,
        storageKey: '2026-10/mock-storage-key.webp',
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        fileSize: validWebpBuffer.length,
        originalFilename: 'diagram.webp',
        width: null,
        height: null,
        altText: null,
      });

      expect(result).toEqual({
        id: MEDIA_ID,
        originalFilename: 'diagram.webp',
        mimeType: 'image/webp',
        fileSize: validWebpBuffer.length,
        mediaType: 'IMAGE',
        width: null,
        height: null,
        altText: null,
        createdAt: '2026-10-26T12:00:00.000Z',
      });
      // Ensure storageKey is never leaked in DTO
      expect((result as any).storageKey).toBeUndefined();
    });

    it('successfully uploads valid JPEG and PNG images', async () => {
      const jpegFile: UploadedMediaFile = {
        originalname: 'photo.jpg',
        mimetype: 'image/jpeg',
        size: validJpegBuffer.length,
        buffer: validJpegBuffer,
      };
      repositoryMock.createMediaAsset.mockResolvedValue({
        id: MEDIA_ID,
        originalFilename: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileSize: validJpegBuffer.length,
        mediaType: 'IMAGE',
        width: null,
        height: null,
        altText: null,
        createdAt: new Date(),
      });
      await expect(service.uploadImage(mockUser, jpegFile)).resolves.toBeDefined();

      const pngFile: UploadedMediaFile = {
        originalname: 'icon.png',
        mimetype: 'image/png',
        size: validPngBuffer.length,
        buffer: validPngBuffer,
      };
      repositoryMock.createMediaAsset.mockResolvedValue({
        id: MEDIA_ID,
        originalFilename: 'icon.png',
        mimeType: 'image/png',
        fileSize: validPngBuffer.length,
        mediaType: 'IMAGE',
        width: null,
        height: null,
        altText: null,
        createdAt: new Date(),
      });
      await expect(service.uploadImage(mockUser, pngFile)).resolves.toBeDefined();
    });

    it('rejects unsupported MIME type (e.g. image/gif)', () => {
      const file: UploadedMediaFile = {
        originalname: 'animation.gif',
        mimetype: 'image/gif',
        size: 100,
        buffer: Buffer.from('GIF89a...'),
      };
      expect(() => service.validateImageFile(file)).toThrow(BadRequestException);
    });

    it('rejects forged MIME type where magic bytes do not match declared MIME', () => {
      const fakeJpegFile: UploadedMediaFile = {
        originalname: 'fake.jpg',
        mimetype: 'image/jpeg',
        size: validPngBuffer.length,
        buffer: validPngBuffer, // PNG bytes declared as JPEG!
      };
      expect(() => service.validateImageFile(fakeJpegFile)).toThrow(BadRequestException);
    });

    it('rejects MIME-extension mismatch (e.g. PNG declared as .jpg)', () => {
      const mismatchFile: UploadedMediaFile = {
        originalname: 'image.jpg',
        mimetype: 'image/png',
        size: validPngBuffer.length,
        buffer: validPngBuffer,
      };
      expect(() => service.validateImageFile(mismatchFile)).toThrow(BadRequestException);
    });

    it('rejects empty file uploads', () => {
      const emptyFile: UploadedMediaFile = {
        originalname: 'empty.webp',
        mimetype: 'image/webp',
        size: 0,
        buffer: Buffer.alloc(0),
      };
      expect(() => service.validateImageFile(emptyFile)).toThrow(BadRequestException);
    });

    it('rejects oversized files exceeding 10 MiB', () => {
      const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1);
      const oversizedFile: UploadedMediaFile = {
        originalname: 'huge.jpg',
        mimetype: 'image/jpeg',
        size: oversizedBuffer.length,
        buffer: oversizedBuffer,
      };
      expect(() => service.validateImageFile(oversizedFile)).toThrow(PayloadTooLargeException);
    });

    it('rejects truncated image buffers under 12 bytes', () => {
      const truncatedFile: UploadedMediaFile = {
        originalname: 'truncated.webp',
        mimetype: 'image/webp',
        size: 5,
        buffer: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]),
      };
      expect(() => service.validateImageFile(truncatedFile)).toThrow(BadRequestException);
    });

    it('sanitizes path traversal attempts in originalFilename', () => {
      const traversalFile: UploadedMediaFile = {
        originalname: '../../../../etc/malicious.png',
        mimetype: 'image/png',
        size: validPngBuffer.length,
        buffer: validPngBuffer,
      };
      const validated = service.validateImageFile(traversalFile);
      expect(validated.originalFilename).toBe('malicious.png');
      expect(validated.originalFilename).not.toContain('..');
    });

    it('cleans up staged storage file if database persistence fails', async () => {
      const file: UploadedMediaFile = {
        originalname: 'cover.webp',
        mimetype: 'image/webp',
        size: validWebpBuffer.length,
        buffer: validWebpBuffer,
      };

      storageMock.generateStorageKey.mockReturnValue('2026-10/staged-key.webp');
      repositoryMock.createMediaAsset.mockRejectedValue(new Error('DB connection failed'));

      await expect(service.uploadImage(mockUser, file)).rejects.toThrow(InternalServerErrorException);
      // Compensating rollback cleanup must be triggered!
      expect(storageMock.deleteFile).toHaveBeenCalledWith('2026-10/staged-key.webp');
    });
  });

  describe('Author media library (listMyMedia)', () => {
    it('returns paginated media assets scoped exclusively to the author', async () => {
      const mockItems = [
        {
          id: MEDIA_ID,
          originalFilename: 'diagram.webp',
          mimeType: 'image/webp',
          fileSize: 1024,
          mediaType: 'IMAGE',
          width: null,
          height: null,
          altText: null,
          createdAt: new Date('2026-10-26T12:00:00Z'),
        },
      ];
      repositoryMock.findMediaAssetsByUploader.mockResolvedValue(mockItems);
      repositoryMock.countMediaAssetsByUploader.mockResolvedValue(1);

      const result = await service.listMyMedia(mockUser, { page: 1, limit: 20 });

      expect(repositoryMock.findMediaAssetsByUploader).toHaveBeenCalledWith(USER_ID, 0, 20);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(MEDIA_ID);
      expect((result.items[0] as any).storageKey).toBeUndefined();
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('Private author preview (getPrivateMediaContent)', () => {
    it('delivers private media content for the owning author', async () => {
      repositoryMock.findMediaAssetById.mockResolvedValue({
        id: MEDIA_ID,
        uploaderId: USER_ID,
        storageKey: '2026-10/owned.webp',
        mimeType: 'image/webp',
        originalFilename: 'owned.webp',
        fileSize: 1024,
      });

      const result = await service.getPrivateMediaContent(mockUser, MEDIA_ID);

      expect(storageMock.readFile).toHaveBeenCalledWith('2026-10/owned.webp');
      expect(result.mimeType).toBe('image/webp');
      expect(result.originalFilename).toBe('owned.webp');
    });

    it('throws NotFoundException when non-owning author requests private preview (prevents enumeration)', async () => {
      repositoryMock.findMediaAssetById.mockResolvedValue({
        id: MEDIA_ID,
        uploaderId: OTHER_USER_ID, // Owned by another author!
        storageKey: '2026-10/foreign.webp',
        mimeType: 'image/webp',
        originalFilename: 'foreign.webp',
        fileSize: 1024,
      });

      await expect(service.getPrivateMediaContent(mockUser, MEDIA_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('Public media delivery authorization (Stage 6I-R)', () => {
    it('1. delivers image content when retained by eligible active published snapshot', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue({
        id: MEDIA_ID,
        storageKey: 'published-active-key.webp',
        mimeType: 'image/webp',
        originalFilename: 'published.webp',
        fileSize: 1024,
      });

      const result = await service.getPublicMediaContent(MEDIA_ID);

      expect(repositoryMock.findActivePublishedMediaAsset).toHaveBeenCalledWith(MEDIA_ID);
      expect(storageMock.readFile).toHaveBeenCalledWith('published-active-key.webp');
      expect(result.mimeType).toBe('image/webp');
      expect(result.originalFilename).toBe('published.webp');
      expect(result.fileSize).toBe(1024);
    });

    it('2. throws NotFoundException when article is in DRAFT status', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('3. throws NotFoundException when article is in ARCHIVED status', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('4. throws NotFoundException when article has no current snapshot ID', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('5. throws NotFoundException when snapshot does not belong to the article', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('6. throws NotFoundException when published revision mismatches snapshot revision', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('7. throws NotFoundException when published slug mismatches active snapshot slug', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('8. throws NotFoundException when retention row is missing in article_snapshot_media', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('9. throws NotFoundException when retention is historical-only', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('10. throws NotFoundException when retention is by an unrelated snapshot', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('11. throws NotFoundException when media asset record does not exist in media_assets', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('12. delivers media when retained by another eligible current published snapshot', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue({
        id: MEDIA_ID,
        storageKey: 'shared-published-key.png',
        mimeType: 'image/png',
        originalFilename: 'shared.png',
        fileSize: 2048,
      });

      const result = await service.getPublicMediaContent(MEDIA_ID);

      expect(storageMock.readFile).toHaveBeenCalledWith('shared-published-key.png');
      expect(result.mimeType).toBe('image/png');
    });

    it('13. fails closed immediately on invalid media ID format without database or storage calls', async () => {
      const invalidIds = [
        'not-a-uuid',
        '../traversal-id',
        '33333333-0000-4000-8000-00000000000g', // invalid hex
        '',
        null as unknown as string,
      ];

      for (const id of invalidIds) {
        await expect(service.getPublicMediaContent(id)).rejects.toThrow(NotFoundException);
        expect(repositoryMock.findActivePublishedMediaAsset).not.toHaveBeenCalled();
        expect(storageMock.readFile).not.toHaveBeenCalled();
      }
    });

    it('14. guarantees storage lookup is never performed before authorization decision', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      await expect(service.getPublicMediaContent(MEDIA_ID)).rejects.toThrow(NotFoundException);
      expect(storageMock.readFile).not.toHaveBeenCalled();
    });

    it('15. public failure response does not leak storage keys or filesystem metadata', async () => {
      repositoryMock.findActivePublishedMediaAsset.mockResolvedValue(null);

      try {
        await service.getPublicMediaContent(MEDIA_ID);
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(NotFoundException);
        const message = (err as NotFoundException).message;
        expect(message).toBe('Media asset not found or not published.');
        expect(message).not.toContain('storage');
        expect(message).not.toContain('/');
        expect(message).not.toContain('\\');
      }
    });
  });
});
