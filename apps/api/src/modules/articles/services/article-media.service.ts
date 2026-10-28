import path from 'node:path';
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { MediaAsset } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { ArticleMediaStorageService } from './article-media-storage.service.js';
import { ArticleMediaRepository } from '../repositories/article-media.repository.js';
import type { ListMediaAssetsQueryDto } from '../dto/list-media-assets-query.dto.js';
import type { MediaAssetResponseDto } from '../dto/media-asset-response.dto.js';
import type { PaginatedMediaAssetsResponseDto } from '../dto/paginated-media-assets-response.dto.js';

export interface UploadedMediaFile {
  fieldname?: string;
  originalname?: string;
  encoding?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

export interface MediaContentResult {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
  fileSize: number;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB

const ALLOWED_MIME_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

/**
 * ArticleMediaService — Orchestrates media upload, private author library,
 * ownership verification, and public active-snapshot media delivery.
 */
@Injectable()
export class ArticleMediaService {
  private readonly logger = new Logger(ArticleMediaService.name);

  constructor(
    private readonly repository: ArticleMediaRepository,
    private readonly storage: ArticleMediaStorageService,
  ) {}

  /**
   * Uploads and stores an image file for the authenticated author.
   */
  async uploadImage(
    user: AuthenticatedUser,
    file?: UploadedMediaFile,
  ): Promise<MediaAssetResponseDto> {
    const validated = this.validateImageFile(file);

    const storageKey = this.storage.generateStorageKey(validated.mimeType);

    // 1. Stage file bytes to private filesystem storage
    try {
      await this.storage.saveFile(storageKey, validated.buffer);
    } catch (err: unknown) {
      this.logger.error(`Storage write failure for ${storageKey}: ${String(err)}`);
      throw new InternalServerErrorException('Failed to persist media file.');
    }

    // 2. Persist media asset metadata row in PostgreSQL
    let asset: MediaAsset;
    try {
      asset = await this.repository.createMediaAsset({
        uploaderId: user.id,
        storageKey,
        mediaType: 'IMAGE',
        mimeType: validated.mimeType,
        fileSize: validated.buffer.length,
        originalFilename: validated.originalFilename,
        width: null,
        height: null,
        altText: null,
      });
    } catch (err: unknown) {
      // Compensating rollback: delete staged file on database error
      this.logger.error(
        `Database failure during media registration. Cleaning up staged file ${storageKey}: ${String(err)}`,
      );
      await this.storage.deleteFile(storageKey);
      throw new InternalServerErrorException('Failed to register media asset.');
    }

    return this.mapToResponseDto(asset);
  }

  /**
   * Lists media assets uploaded by the current author with pagination.
   */
  async listMyMedia(
    user: AuthenticatedUser,
    query: ListMediaAssetsQueryDto,
  ): Promise<PaginatedMediaAssetsResponseDto> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.repository.findMediaAssetsByUploader(user.id, skip, limit),
      this.repository.countMediaAssetsByUploader(user.id),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      items: items.map((item) => this.mapToResponseDto(item)),
      page,
      limit,
      total,
      totalPages,
    };
  }

  /**
   * Delivers private media content for author preview, enforcing strict ownership.
   */
  async getPrivateMediaContent(
    user: AuthenticatedUser,
    mediaId: string,
  ): Promise<MediaContentResult> {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!mediaId || typeof mediaId !== 'string' || !UUID_REGEX.test(mediaId)) {
      throw new NotFoundException('Media asset not found.');
    }

    const media = await this.repository.findMediaAssetById(mediaId);

    // Information disclosure prevention: 404 for non-existent or foreign-owned assets
    if (!media || (media.uploaderId !== user.id && user.role !== UserRole.ADMIN)) {
      throw new NotFoundException('Media asset not found.');
    }

    const buffer = await this.storage.readFile(media.storageKey);

    return {
      buffer,
      mimeType: media.mimeType,
      originalFilename: media.originalFilename,
      fileSize: media.fileSize,
    };
  }

  /**
   * Delivers public media content only if referenced by the current immutable snapshot
   * of an eligible PUBLISHED article.
   */
  async getPublicMediaContent(mediaId: string): Promise<MediaContentResult> {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!mediaId || typeof mediaId !== 'string' || !UUID_REGEX.test(mediaId)) {
      throw new NotFoundException('Media asset not found or not published.');
    }

    const record = await this.repository.findActivePublishedMediaAsset(mediaId);

    if (!record) {
      throw new NotFoundException('Media asset not found or not published.');
    }

    const buffer = await this.storage.readFile(record.storageKey);

    return {
      buffer,
      mimeType: record.mimeType,
      originalFilename: record.originalFilename,
      fileSize: record.fileSize,
    };
  }

  /**
   * Validates file presence, size, MIME type, magic bytes signature, and filename.
   */
  validateImageFile(file?: UploadedMediaFile): {
    buffer: Buffer;
    mimeType: string;
    originalFilename: string;
  } {
    if (!file || !file.buffer) {
      throw new BadRequestException('A file is required for upload.');
    }

    if (file.buffer.length === 0 || (file.size !== undefined && file.size === 0)) {
      throw new BadRequestException('Uploaded file cannot be empty.');
    }

    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new PayloadTooLargeException('File size exceeds the 10 MiB limit.');
    }

    const rawMime = (file.mimetype || '').toLowerCase().trim();
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_MIME_EXTENSIONS, rawMime)) {
      throw new BadRequestException(
        'Unsupported media MIME type. Supported types: image/jpeg, image/png, image/webp.',
      );
    }

    // Verify magic bytes signature
    const buffer = file.buffer;
    const detectedMime = this.detectMimeFromSignature(buffer);

    if (!detectedMime || detectedMime !== rawMime) {
      throw new BadRequestException(
        'File content signature does not match declared MIME type.',
      );
    }

    // Sanitize filename and verify extension
    const originalName = file.originalname || 'upload.bin';
    const baseName = path.basename(originalName).trim();
    const ext = path.extname(baseName).toLowerCase();

    const allowedExts = ALLOWED_MIME_EXTENSIONS[detectedMime] ?? [];
    if (!allowedExts.includes(ext)) {
      throw new BadRequestException(
        `File extension "${ext}" does not match the image format ${detectedMime}.`,
      );
    }

    const safeFilename = baseName.slice(0, 255) || 'upload.bin';

    return {
      buffer,
      mimeType: detectedMime,
      originalFilename: safeFilename,
    };
  }

  /**
   * Inspects binary magic bytes to determine canonical image type.
   */
  private detectMimeFromSignature(buffer: Buffer): string | null {
    if (buffer.length < 12) {
      return null;
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png';
    }

    // WebP: RIFF ... WEBP
    // Bytes 0-3: 'RIFF' (0x52, 0x49, 0x46, 0x46)
    // Bytes 8-11: 'WEBP' (0x57, 0x45, 0x42, 0x50)
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return 'image/webp';
    }

    return null;
  }

  /**
   * Projects a database MediaAsset to a safe response DTO without exposing storage keys.
   */
  private mapToResponseDto(asset: MediaAsset): MediaAssetResponseDto {
    return {
      id: asset.id,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      mediaType: asset.mediaType,
      width: asset.width,
      height: asset.height,
      altText: asset.altText,
      createdAt: asset.createdAt.toISOString(),
    };
  }
}
