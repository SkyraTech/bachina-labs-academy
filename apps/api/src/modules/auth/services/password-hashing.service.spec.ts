import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { PasswordHashingService } from './password-hashing.service.js';

/**
 * Unit tests for PasswordHashingService.
 *
 * Tests use the REAL argon2 library (not mocked) to verify:
 *   - hash() produces an Argon2id-format string
 *   - hash() never returns the plaintext password
 *   - verify() correctly identifies matching passwords
 *   - verify() correctly rejects non-matching passwords
 *   - hash() produces unique results for the same password (random salt)
 *   - errors are wrapped as InternalServerErrorException without leaking details
 */
describe('PasswordHashingService', () => {
  let service: PasswordHashingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordHashingService],
    }).compile();

    service = module.get<PasswordHashingService>(PasswordHashingService);
  });

  // ── hash() ───────────────────────────────────────────────────────────────────

  describe('hash()', () => {
    it('produces an Argon2id hash string', async () => {
      const result = await service.hash('correct-horse-battery-staple');
      expect(result).toMatch(/^\$argon2id\$/);
    }, 15_000);

    it('embeds the configured parameters in the hash string', async () => {
      const result = await service.hash('correct-horse-battery-staple');
      // m=19456 (19 MiB), t=2, p=1
      expect(result).toContain('m=19456');
      expect(result).toContain('t=2');
      expect(result).toContain('p=1');
    }, 15_000);

    it('never returns the plaintext password', async () => {
      const password = 'correct-horse-battery-staple';
      const result = await service.hash(password);
      expect(result).not.toContain(password);
    }, 15_000);

    it('produces unique hashes for the same input (random salt)', async () => {
      const password = 'same-password-unique-salts';
      const hash1 = await service.hash(password);
      const hash2 = await service.hash(password);
      expect(hash1).not.toBe(hash2);
    }, 30_000);
  });

  // ── verify() ─────────────────────────────────────────────────────────────────

  describe('verify()', () => {
    it('returns true when password matches the hash', async () => {
      const password = 'correct-horse-battery-staple';
      const hashed = await service.hash(password);
      const result = await service.verify(hashed, password);
      expect(result).toBe(true);
    }, 30_000);

    it('returns false when password does not match the hash', async () => {
      const hashed = await service.hash('original-password-12345');
      const result = await service.verify(hashed, 'wrong-password-12345');
      expect(result).toBe(false);
    }, 30_000);

    it('returns false for an empty string against a real hash', async () => {
      const hashed = await service.hash('some-real-password-here');
      const result = await service.verify(hashed, '');
      expect(result).toBe(false);
    }, 30_000);
  });

  // ── Error wrapping ────────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('wraps verify errors as InternalServerErrorException', async () => {
      // Passing a malformed hash string causes argon2 to throw internally
      await expect(
        service.verify('not-a-valid-hash', 'some-password'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
