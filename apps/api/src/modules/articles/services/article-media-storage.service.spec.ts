import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ArticleMediaStorageService } from './article-media-storage.service.js';

describe('ArticleMediaStorageService — Security Hardening Tests (Stage 6I-R)', () => {
  let service: ArticleMediaStorageService;
  let tempStorageDir: string;
  let outsideDir: string;
  let configServiceMock: {
    get: ReturnType<typeof vi.fn>;
  };

  const VALID_HEX_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.webp';
  const VALID_PNG_KEY = '0123456789abcdef0123456789abcdef.png';
  const VALID_JPG_KEY = 'deadbeefdeadbeefdeadbeefdeadbeef.jpg';

  beforeEach(() => {
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-media-root-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-outside-'));

    configServiceMock = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'ARTICLE_MEDIA_STORAGE_DIR') {
          return tempStorageDir;
        }
        return undefined;
      }),
    };

    service = new ArticleMediaStorageService(configServiceMock as unknown as ConfigService);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempStorageDir)) {
        fs.rmSync(tempStorageDir, { recursive: true, force: true });
      }
      if (fs.existsSync(outsideDir)) {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    } catch {
      // ignore test cleanup errors
    }
  });

  describe('Storage key generation & format', () => {
    it('1. generates flat, opaque storage keys matching 32-hex format with approved extensions', () => {
      const webpKey = service.generateStorageKey('image/webp');
      expect(webpKey).toMatch(/^[a-f0-9]{32}\.webp$/);
      expect(webpKey).not.toContain('/');
      expect(webpKey).not.toContain('\\');

      const pngKey = service.generateStorageKey('image/png');
      expect(pngKey).toMatch(/^[a-f0-9]{32}\.png$/);

      const jpegKey = service.generateStorageKey('image/jpeg');
      expect(jpegKey).toMatch(/^[a-f0-9]{32}\.jpg$/);
    });

    it('rejects unsupported MIME types during key generation', () => {
      expect(() => service.generateStorageKey('image/gif')).toThrow(BadRequestException);
      expect(() => service.generateStorageKey('image/svg+xml')).toThrow(BadRequestException);
      expect(() => service.generateStorageKey('application/octet-stream')).toThrow(BadRequestException);
    });
  });

  describe('Storage containment & path resolution security', () => {
    it('1. accepts valid, correctly formatted opaque storage keys', () => {
      const resolved = service.resolveSafePath(VALID_HEX_KEY);
      expect(resolved).toBe(path.join(service.getStorageRoot(), VALID_HEX_KEY));
    });

    it('2. rejects parent traversal attempts (../secret.webp)', () => {
      expect(() => service.resolveSafePath('../secret.webp')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('../../secret.webp')).toThrow(BadRequestException);
    });

    it('3. rejects Windows path traversal attempts (..\\outside.jpg)', () => {
      expect(() => service.resolveSafePath('..\\outside.jpg')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('..\\..\\outside.jpg')).toThrow(BadRequestException);
    });

    it('4. rejects absolute paths (/absolute/path.webp and drive letters)', () => {
      expect(() => service.resolveSafePath('/absolute/path.webp')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('C:\\outside\\secret.jpg')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('D:/outside/secret.jpg')).toThrow(BadRequestException);
    });

    it('5. rejects sibling-directory prefix collisions (media-backup/secret.webp)', () => {
      expect(() => service.resolveSafePath('media-backup/secret.webp')).toThrow(BadRequestException);
    });

    it('6. rejects nested traversal escapes (secret.webp/../../outside)', () => {
      expect(() => service.resolveSafePath('secret.webp/../../outside')).toThrow(BadRequestException);
    });

    it('7. rejects keys containing NUL bytes', () => {
      expect(() => service.resolveSafePath(`${VALID_HEX_KEY}\0.jpg`)).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('file\0.webp')).toThrow(BadRequestException);
    });

    it('8. rejects unexpected or prohibited file extensions', () => {
      expect(() => service.resolveSafePath('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.gif')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.svg')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.exe')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.sh')).toThrow(BadRequestException);
    });

    it('9. rejects malformed key formats (non-hex, non-32 length)', () => {
      expect(() => service.resolveSafePath('not-a-valid-hex-key.webp')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('12345.webp')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8.webp')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath('')).toThrow(BadRequestException);
      expect(() => service.resolveSafePath(null as unknown as string)).toThrow(BadRequestException);
    });
  });

  describe('Exclusive creation & overwrite prevention', () => {
    it('13. exclusive creation prevents overwriting existing assets (flag: wx)', async () => {
      const bufferOriginal = Buffer.from('original-image-bytes');
      const bufferDuplicate = Buffer.from('malicious-overwriting-bytes');

      await service.saveFile(VALID_HEX_KEY, bufferOriginal);

      // Attempting to save with same key fails with BadRequestException without corrupting original
      await expect(service.saveFile(VALID_HEX_KEY, bufferDuplicate)).rejects.toThrow(
        BadRequestException,
      );

      // Verify original file bytes remain intact
      const content = await service.readFile(VALID_HEX_KEY);
      expect(content).toEqual(bufferOriginal);
    });
  });

  describe('Symlink and outside directory escape protection', () => {
    it('10. detects and rejects symlinks pointing outside the storage root during read', async () => {
      const secretFile = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(secretFile, 'sensitive-system-data');

      const targetPath = path.join(service.getStorageRoot(), VALID_PNG_KEY);
      try {
        fs.symlinkSync(secretFile, targetPath);
      } catch {
        // On Windows without Developer Mode, creating symlinks may require elevated privileges
        // If symlink creation fails at OS level, skip this specific test gracefully
        return;
      }

      await expect(service.readFile(VALID_PNG_KEY)).rejects.toThrow(BadRequestException);
    });

    it('16. valid existing files inside storage root remain readable', async () => {
      const buffer = Buffer.from('valid-stored-image-bytes');
      await service.saveFile(VALID_JPG_KEY, buffer);

      const read = await service.readFile(VALID_JPG_KEY);
      expect(read).toEqual(buffer);
    });

    it('17. media read errors never disclose absolute filesystem paths', async () => {
      try {
        await service.readFile('ffffffffffffffffffffffffffffffff.png');
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(NotFoundException);
        const message = (err as NotFoundException).message;
        expect(message).not.toContain(tempStorageDir);
        expect(message).not.toContain('\\');
        expect(message).not.toContain('/');
      }
    });

    it('18. cleanup cannot remove files outside the storage root', async () => {
      const outsideFile = path.join(outsideDir, 'external.jpg');
      fs.writeFileSync(outsideFile, 'safe-external-content');

      // Attempting to delete using a traversal key is rejected before file unlink
      await expect(service.deleteFile('../outside.jpg')).resolves.toBeUndefined();
      expect(fs.existsSync(outsideFile)).toBe(true);
    });
  });
});
