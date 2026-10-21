import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { validateTrustProxy, getClientIp } from './client-ip.util';

describe('client-ip.util', () => {
  describe('validateTrustProxy', () => {
    it('returns false for undefined, null, empty string, or "false"', () => {
      expect(validateTrustProxy(undefined)).toBe(false);
      expect(validateTrustProxy('')).toBe(false);
      expect(validateTrustProxy('   ')).toBe(false);
      expect(validateTrustProxy('false')).toBe(false);
      expect(validateTrustProxy('FALSE')).toBe(false);
    });

    it('rejects blind "true" with an explicit security error', () => {
      expect(() => validateTrustProxy('true')).toThrow(
        /Insecure TRUST_PROXY configuration: blind "true" is prohibited/,
      );
      expect(() => validateTrustProxy('TRUE')).toThrow(
        /Insecure TRUST_PROXY configuration: blind "true" is prohibited/,
      );
    });

    it('parses valid integer hop counts', () => {
      expect(validateTrustProxy('1')).toBe(1);
      expect(validateTrustProxy('2')).toBe(2);
      expect(validateTrustProxy('10')).toBe(10);
    });

    it('rejects invalid integer hop counts (0 or > 20)', () => {
      expect(() => validateTrustProxy('0')).toThrow(/Must be an integer between 1 and 20/);
      expect(() => validateTrustProxy('25')).toThrow(/Must be an integer between 1 and 20/);
    });

    it('accepts valid Express network keywords', () => {
      expect(validateTrustProxy('loopback')).toBe('loopback');
      expect(validateTrustProxy('linklocal')).toBe('linklocal');
      expect(validateTrustProxy('uniquelocal')).toBe('uniquelocal');
    });

    it('accepts valid IP addresses and CIDR subnets', () => {
      expect(validateTrustProxy('127.0.0.1')).toBe('127.0.0.1');
      expect(validateTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
      expect(validateTrustProxy('192.168.1.1, 10.0.0.0/8')).toEqual([
        '192.168.1.1',
        '10.0.0.0/8',
      ]);
      expect(validateTrustProxy('::1')).toBe('::1');
    });

    it('rejects invalid tokens or malformed strings', () => {
      expect(() => validateTrustProxy('not-an-ip')).toThrow(
        /Invalid TRUST_PROXY configuration token/,
      );
      expect(() => validateTrustProxy('999.999.999.999')).toThrow(
        /Invalid TRUST_PROXY configuration token/,
      );
      expect(() => validateTrustProxy('10.0.0.0/35')).toThrow(
        /Invalid TRUST_PROXY configuration token/,
      );
    });
  });

  describe('getClientIp', () => {
    it('returns req.ip when available', () => {
      const mockReq = { ip: '203.0.113.195' } as unknown as Request;
      expect(getClientIp(mockReq)).toBe('203.0.113.195');
    });

    it('normalizes IPv4-mapped IPv6 address (::ffff:x.x.x.x)', () => {
      const mockReq = { ip: '::ffff:198.51.100.22' } as unknown as Request;
      expect(getClientIp(mockReq)).toBe('198.51.100.22');
    });

    it('falls back to socket.remoteAddress when req.ip is not set', () => {
      const mockReq = {
        socket: { remoteAddress: '192.0.2.1' },
      } as unknown as Request;
      expect(getClientIp(mockReq)).toBe('192.0.2.1');
    });

    it('falls back to 127.0.0.1 when neither is set', () => {
      const mockReq = {} as unknown as Request;
      expect(getClientIp(mockReq)).toBe('127.0.0.1');
    });
  });
});
