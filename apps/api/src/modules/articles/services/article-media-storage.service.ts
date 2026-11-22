import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ArticleMediaStorageService — Private filesystem storage adapter.
 *
 * Enforces:
 * - Server-controlled unique, opaque storage keys without directory separators.
 * - Path-component-aware directory containment (anti-prefix-collision).
 * - Exclusive file creation flags ('wx') preventing overwrite or symlink hijacking.
 * - Symlink and filesystem escape verification on read and cleanup.
 * - Outside publicly served static web roots.
 * - Zero leakage of internal filesystem paths in error responses.
 */
@Injectable()
export class ArticleMediaStorageService {
  private static readonly STORAGE_KEY_PATTERN = /^[a-f0-9]{32}\.(jpg|jpeg|png|webp)$/i;

  private readonly logger = new Logger(ArticleMediaStorageService.name);
  private readonly storageRoot: string;
  private readonly provider: string;
  private readonly supabaseUrl?: string;
  private readonly supabaseKey?: string;
  private readonly supabaseBucket?: string;

  constructor(private readonly configService: ConfigService) {
    this.provider = this.configService.get<string>('STORAGE_PROVIDER') || 'local';
    this.supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    this.supabaseKey = this.configService.get<string>('SUPABASE_SECRET_KEY');
    this.supabaseBucket =
      this.configService.get<string>('SUPABASE_STORAGE_BUCKET') ||
      this.configService.get<string>('STORAGE_BUCKET') ||
      'Article-media';

    const configuredDir = this.configService.get<string>('ARTICLE_MEDIA_STORAGE_DIR');
    const baseDir = path.normalize(
      configuredDir
        ? path.resolve(configuredDir)
        : path.resolve(process.cwd(), 'storage', 'articles', 'media'),
    );

    // Ensure the storage directory exists on startup
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    // Canonicalize root path resolving any symlinks and case/drive variations
    this.storageRoot = fs.realpathSync(baseDir);
  }

  /**
   * Returns the canonical storage root path.
   */
  getStorageRoot(): string {
    return this.storageRoot;
  }

  /**
   * Generates a unique, opaque server-controlled storage key without directory separators.
   * Format: <32-hex-characters>.<extension>
   */
  generateStorageKey(mimeType: string): string {
    const extension = this.getExtensionForMimeType(mimeType);
    const randomHex = crypto.randomBytes(16).toString('hex');
    return `${randomHex}.${extension}`;
  }

  /**
   * Resolves and validates a storage key against the storage root jail.
   * Enforces:
   * 1. No directory separators (/ or \).
   * 2. No null bytes (\0).
   * 3. No double dots (..).
   * 4. Strict format matching (32 hex characters + approved image extension).
   * 5. Path-component-aware containment check via path.relative.
   *
   * Throws BadRequestException on directory traversal, format mismatch, or escape attempts.
   */
  resolveSafePath(storageKey: string): string {
    if (!storageKey || typeof storageKey !== 'string') {
      throw new BadRequestException('Invalid storage key.');
    }

    // 1. Explicit prohibition of path separators and special characters in opaque keys
    if (
      storageKey.includes('\0') ||
      storageKey.includes('..') ||
      storageKey.includes('/') ||
      storageKey.includes('\\') ||
      path.isAbsolute(storageKey)
    ) {
      throw new BadRequestException('Invalid storage key format.');
    }

    // 2. Strict whitelist validation against approved opaque server-generated format
    if (!ArticleMediaStorageService.STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new BadRequestException('Storage key does not match accepted format.');
    }

    // 3. Path-component-aware containment check (replaces flawed prefix startsWith)
    const candidatePath = path.resolve(this.storageRoot, storageKey);
    const relative = path.relative(this.storageRoot, candidatePath);

    const escapesRoot =
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative);

    if (escapesRoot) {
      throw new BadRequestException('Storage path outside permitted root.');
    }

    return candidatePath;
  }

  /**
   * Writes file bytes to private filesystem storage with exclusive creation flag ('wx').
   * Prevents overwriting existing assets or following pre-existing symlinks.
   */
  async saveFile(storageKey: string, buffer: Buffer): Promise<void> {
    if (this.provider === 'supabase' && this.supabaseUrl && this.supabaseKey) {
      await this.saveToSupabase(storageKey, buffer);
      return;
    }

    const filePath = this.resolveSafePath(storageKey);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    try {
      await fs.promises.writeFile(filePath, buffer, { flag: 'wx' });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'EEXIST') {
        throw new BadRequestException('Storage object already exists.');
      }
      this.logger.error(`Failed to write storage file for key ${storageKey}: ${String(err)}`);
      throw err;
    }
  }

  /**
   * Reads file bytes from private filesystem storage.
   * Verifies symlink containment and file type before streaming bytes.
   */
  async readFile(storageKey: string): Promise<Buffer> {
    if (this.provider === 'supabase' && this.supabaseUrl && this.supabaseKey) {
      return await this.readFromSupabase(storageKey);
    }

    const filePath = this.resolveSafePath(storageKey);
    try {
      const stat = await fs.promises.lstat(filePath);

      if (stat.isSymbolicLink()) {
        const realPath = await fs.promises.realpath(filePath);
        const relativeReal = path.relative(this.storageRoot, realPath);
        if (
          relativeReal === '..' ||
          relativeReal.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeReal)
        ) {
          throw new BadRequestException('Symbolic link target outside permitted root.');
        }
      } else if (!stat.isFile()) {
        throw new NotFoundException('Requested media file could not be found.');
      }

      return await fs.promises.readFile(filePath);
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.warn(`Storage file missing for key ${storageKey}`);
      throw new NotFoundException('Requested media file could not be found.');
    }
  }

  /**
   * Deletes a file from storage, typically used for rollback after a failed database transaction.
   * Path-contained to guarantee never deleting outside the storage root.
   */
  async deleteFile(storageKey: string): Promise<void> {
    if (this.provider === 'supabase' && this.supabaseUrl && this.supabaseKey) {
      await this.deleteFromSupabase(storageKey);
      return;
    }

    try {
      const filePath = this.resolveSafePath(storageKey);
      const stat = await fs.promises.lstat(filePath).catch(() => null);
      if (stat) {
        await fs.promises.unlink(filePath);
      }
    } catch (err: unknown) {
      this.logger.error(`Failed to delete storage file for key ${storageKey}: ${String(err)}`);
    }
  }

  /**
   * Maps accepted image MIME types to standard file extensions.
   */
  private getExtensionForMimeType(mimeType: string): string {
    switch (mimeType.toLowerCase()) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      default:
        throw new BadRequestException(`Unsupported MIME type: ${mimeType}`);
    }
  }

  private async saveToSupabase(storageKey: string, buffer: Buffer): Promise<void> {
    const ext = path.extname(storageKey).slice(1).toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const uploadUrl = `${this.supabaseUrl}/storage/v1/object/${this.supabaseBucket}/${storageKey}`;

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.supabaseKey}`,
        apikey: this.supabaseKey || '',
        'Content-Type': mimeType,
        'x-upsert': 'false',
      },
      body: new Uint8Array(buffer),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(`Supabase upload failed (${res.status}): ${errText}`);
      if (res.status === 409 || errText.includes('already exists')) {
        throw new BadRequestException('Storage object already exists.');
      }
      throw new BadRequestException(`Failed to persist media in Supabase storage: ${res.statusText}`);
    }
  }

  private async readFromSupabase(storageKey: string): Promise<Buffer> {
    const downloadUrl = `${this.supabaseUrl}/storage/v1/object/${this.supabaseBucket}/${storageKey}`;
    const res = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${this.supabaseKey}`,
        apikey: this.supabaseKey || '',
      },
    });

    if (!res.ok) {
      this.logger.warn(`Supabase storage file missing for key ${storageKey} (${res.status})`);
      throw new NotFoundException('Requested media file could not be found.');
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  private async deleteFromSupabase(storageKey: string): Promise<void> {
    const deleteUrl = `${this.supabaseUrl}/storage/v1/object/${this.supabaseBucket}/${storageKey}`;
    try {
      await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.supabaseKey}`,
          apikey: this.supabaseKey || '',
        },
      });
    } catch (err: unknown) {
      this.logger.error(`Failed to delete Supabase storage file for key ${storageKey}: ${String(err)}`);
    }
  }
}
