import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import {
  buildJwtConfig,
  resolvePemKey,
  validateRsaKeyPair,
} from './jwt.config';

describe('jwt.config', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  describe('resolvePemKey', () => {
    it('returns empty string for empty input', () => {
      expect(resolvePemKey('')).toBe('');
      expect(resolvePemKey(undefined)).toBe('');
    });

    it('resolves raw multiline PEM with escaped newlines', () => {
      const escaped = privateKey.replace(/\n/g, '\\n');
      const resolved = resolvePemKey(escaped);
      expect(resolved).toBe(privateKey.trim());
    });

    it('resolves base64-encoded PEM string', () => {
      const b64 = Buffer.from(publicKey).toString('base64');
      const resolved = resolvePemKey(b64);
      expect(resolved).toBe(publicKey.trim());
    });
  });

  describe('validateRsaKeyPair', () => {
    it('succeeds for valid paired keys', () => {
      expect(() => validateRsaKeyPair(privateKey, publicKey)).not.toThrow();
    });

    it('throws when public key belongs to another keypair', () => {
      const otherPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      expect(() => validateRsaKeyPair(privateKey, otherPair.publicKey)).toThrow(
        /do not match/i,
      );
    });

    it('throws on corrupted key material', () => {
      expect(() => validateRsaKeyPair('not-a-key', publicKey)).toThrow(
        /Invalid RSA key/i,
      );
    });
  });

  describe('buildJwtConfig', () => {
    it('builds valid config with custom values', () => {
      const config = buildJwtConfig({
        NODE_ENV: 'production',
        JWT_ACCESS_PRIVATE_KEY: privateKey,
        JWT_ACCESS_PUBLIC_KEY: publicKey,
        JWT_ACCESS_ISSUER: 'custom-issuer',
        JWT_ACCESS_AUDIENCE: 'custom-audience',
        JWT_ACCESS_TTL_SECONDS: '600',
        AUTH_COOKIE_SECURE: 'true',
        AUTH_COOKIE_SAMESITE: 'strict',
      });

      expect(config.issuer).toBe('custom-issuer');
      expect(config.audience).toBe('custom-audience');
      expect(config.accessTtlSeconds).toBe(600);
      expect(config.cookieSecure).toBe(true);
      expect(config.cookieSameSite).toBe('strict');
    });

    it('throws in production when private key is missing', () => {
      expect(() =>
        buildJwtConfig({
          NODE_ENV: 'production',
          JWT_ACCESS_PUBLIC_KEY: publicKey,
        }),
      ).toThrow(/Missing JWT_ACCESS_PRIVATE_KEY/i);
    });

    it('throws in production when public key is missing', () => {
      expect(() =>
        buildJwtConfig({
          NODE_ENV: 'production',
          JWT_ACCESS_PRIVATE_KEY: privateKey,
        }),
      ).toThrow(/Missing JWT_ACCESS_PUBLIC_KEY/i);
    });

    it('provides ephemeral keys in test environment if none are provided', () => {
      const config = buildJwtConfig({
        NODE_ENV: 'test',
      });

      expect(config.privateKey).toContain('BEGIN PRIVATE KEY');
      expect(config.publicKey).toContain('BEGIN PUBLIC KEY');
      expect(() => validateRsaKeyPair(config.privateKey, config.publicKey)).not.toThrow();
    });
  });
});
