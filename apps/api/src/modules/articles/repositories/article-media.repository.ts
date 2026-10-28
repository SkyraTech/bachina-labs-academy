import { Injectable } from '@nestjs/common';
import type { MediaAsset, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';

export interface CreateMediaAssetData {
  uploaderId: string;
  storageKey: string;
  mediaType: string;
  mimeType: string;
  fileSize: number;
  originalFilename: string;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
}

export interface ActivePublishedMediaRecord {
  id: string;
  storageKey: string;
  mimeType: string;
  originalFilename: string;
  fileSize: number;
}

/**
 * ArticleMediaRepository — Data access layer for media assets.
 *
 * Enforces:
 * - Scoped owner queries.
 * - Active published snapshot retention verification in PostgreSQL.
 * - Safe projection of metadata without leaking credentials.
 */
@Injectable()
export class ArticleMediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a new media asset record.
   */
  async createMediaAsset(
    data: CreateMediaAssetData,
    tx?: Prisma.TransactionClient,
  ): Promise<MediaAsset> {
    const client = tx ?? this.prisma;
    return client.mediaAsset.create({
      data: {
        uploaderId: data.uploaderId,
        storageKey: data.storageKey,
        mediaType: data.mediaType,
        mimeType: data.mimeType,
        fileSize: data.fileSize,
        originalFilename: data.originalFilename,
        width: data.width ?? null,
        height: data.height ?? null,
        altText: data.altText ?? null,
      },
    });
  }

  /**
   * Finds a media asset by ID.
   */
  async findMediaAssetById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<MediaAsset | null> {
    const client = tx ?? this.prisma;
    return client.mediaAsset.findUnique({
      where: { id },
    });
  }

  /**
   * Finds a media asset strictly scoped to its authenticated uploader.
   */
  async findMediaAssetForOwner(
    id: string,
    uploaderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<MediaAsset | null> {
    const client = tx ?? this.prisma;
    return client.mediaAsset.findFirst({
      where: {
        id,
        uploaderId,
      },
    });
  }

  /**
   * Lists media assets uploaded by a specific author, ordered newest-first.
   */
  async findMediaAssetsByUploader(
    uploaderId: string,
    skip: number,
    take: number,
  ): Promise<MediaAsset[]> {
    return this.prisma.mediaAsset.findMany({
      where: { uploaderId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  /**
   * Counts the total number of media assets uploaded by a specific author.
   */
  async countMediaAssetsByUploader(uploaderId: string): Promise<number> {
    return this.prisma.mediaAsset.count({
      where: { uploaderId },
    });
  }

  /**
   * Verifies that a media asset is referenced by the current immutable snapshot
   * of an eligible PUBLISHED article.
   *
   * Verifies through:
   * - articles.status = 'PUBLISHED'
   * - articles.current_snapshot_id is valid and equals s.id
   * - Snapshot belongs to article (a.id = s.article_id)
   * - Published revision matches snapshot revision (a.published_revision = s.snapshot_revision)
   * - Published slug matches active snapshot (a.published_slug = s.published_slug)
   * - article_snapshot_media.snapshot_id is the active snapshot ID (asm.snapshot_id = s.id)
   * - article_snapshot_media.media_asset_id equals requested media ID (asm.media_asset_id = m.id)
   * - Media asset exists (m.id = mediaId)
   */
  async findActivePublishedMediaAsset(
    mediaId: string,
  ): Promise<ActivePublishedMediaRecord | null> {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!mediaId || typeof mediaId !== 'string' || !UUID_REGEX.test(mediaId)) {
      return null;
    }

    const rows = await this.prisma.$queryRaw<ActivePublishedMediaRecord[]>`
      SELECT 
        m.id,
        m.storage_key AS "storageKey",
        m.mime_type AS "mimeType",
        m.original_filename AS "originalFilename",
        m.file_size AS "fileSize"
      FROM media_assets m
      JOIN article_snapshot_media asm 
        ON asm.media_asset_id = m.id
      JOIN article_snapshots s 
        ON s.id = asm.snapshot_id
      JOIN articles a 
        ON a.current_snapshot_id = s.id 
        AND a.id = s.article_id
      WHERE m.id = ${mediaId}::uuid
        AND a.status = 'PUBLISHED'
        AND a.published_slug IS NOT NULL
        AND a.current_snapshot_id IS NOT NULL
        AND a.published_revision >= 1
        AND a.published_revision <= a.draft_revision
        AND a.published_revision = s.snapshot_revision
        AND a.published_slug = s.published_slug
      LIMIT 1;
    `;
    return rows[0] ?? null;
  }

  /**
   * Deletes a media asset record (used for compensating cleanup).
   */
  async deleteMediaAsset(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.mediaAsset.delete({
      where: { id },
    });
  }
}
