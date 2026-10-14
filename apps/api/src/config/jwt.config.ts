import { registerAs } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface JwtConfig {
  privateKey: string;
  publicKey: string;
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
  sessionDefaultTtlHours: number;
  sessionRememberTtlDays: number;
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  cookieDomain?: string;
}

/**
 * Resolves a PEM key string from either:
 * 1. An existing filesystem path (e.g. "./certs/jwt-private.pem").
 * 2. A multiline PEM string with literal or escaped newlines.
 * 3. A base64-encoded PEM string.
 */
export function resolvePemKey(val?: string, baseDir: string = process.cwd()): string {
  if (!val || val.trim().length === 0) {
    return '';
  }

  const trimmed = val.trim();

  // 1. Check if it points to an existing file
  const candidatePaths = [
    trimmed,
    path.resolve(baseDir, trimmed),
    path.resolve(baseDir, 'apps/api', trimmed),
    path.resolve(baseDir, 'certs', trimmed),
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return fs.readFileSync(p, 'utf8').trim();
      }
    } catch {
      // Continue to next check
    }
  }

  // 2. Check if it's already a PEM string (with actual or escaped newlines)
  if (trimmed.includes('BEGIN ') && trimmed.includes('KEY-----')) {
    return trimmed.replace(/\\n/g, '\n').trim();
  }

  // 3. Check if base64 encoded
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded.includes('BEGIN ') && decoded.includes('KEY-----')) {
      return decoded.trim();
    }
  } catch {
    // Ignore and return trimmed
  }

  return trimmed;
}

/**
 * Verifies that the private and public keys are valid RSA keys and form a matched keypair.
 */
export function validateRsaKeyPair(privateKeyPem: string, publicKeyPem: string): void {
  try {
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const publicKey = crypto.createPublicKey(publicKeyPem);

    // Verify key pairing by signing and verifying a test payload
    const testData = Buffer.from('academy-rsa-pairing-check', 'utf8');
    const signer = crypto.createSign('SHA256');
    signer.update(testData);
    signer.end();
    const signature = signer.sign(privateKey);

    const verifier = crypto.createVerify('SHA256');
    verifier.update(testData);
    verifier.end();
    const verified = verifier.verify(publicKey, signature);

    if (!verified) {
      throw new Error('RSA private and public keys do not match.');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid RSA key configuration: ${msg}`);
  }
}

/**
 * Ephemeral test keypair cache for test environment.
 */
let cachedTestKeyPair: { privateKey: string; publicKey: string } | null = null;

export function getEphemeralTestKeyPair(): { privateKey: string; publicKey: string } {
  if (!cachedTestKeyPair) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    cachedTestKeyPair = { privateKey, publicKey };
  }
  return cachedTestKeyPair;
}

export function buildJwtConfig(env: Record<string, string | undefined>): JwtConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  let privateKey = resolvePemKey(env.JWT_ACCESS_PRIVATE_KEY);
  let publicKey = resolvePemKey(env.JWT_ACCESS_PUBLIC_KEY);

  // If in development and not specified in env, try local default certs
  if (!privateKey && !isProd) {
    privateKey = resolvePemKey('./certs/jwt-private.pem');
  }
  if (!publicKey && !isProd) {
    publicKey = resolvePemKey('./certs/jwt-public.pem');
  }

  // If in test environment and keys are still absent, supply ephemeral in-memory keypair
  if ((!privateKey || !publicKey) && isTest) {
    const testKeys = getEphemeralTestKeyPair();
    privateKey = privateKey || testKeys.privateKey;
    publicKey = publicKey || testKeys.publicKey;
  }

  if (!privateKey) {
    throw new Error(
      'Missing JWT_ACCESS_PRIVATE_KEY. Provide a valid RSA private key PEM or file path.',
    );
  }

  if (!publicKey) {
    throw new Error(
      'Missing JWT_ACCESS_PUBLIC_KEY. Provide a valid RSA public key PEM or file path.',
    );
  }

  // Validate the keypair
  validateRsaKeyPair(privateKey, publicKey);

  const accessTtlSeconds = parseInt(env.JWT_ACCESS_TTL_SECONDS ?? '900', 10);
  if (isNaN(accessTtlSeconds) || accessTtlSeconds <= 0) {
    throw new Error('JWT_ACCESS_TTL_SECONDS must be a positive integer.');
  }

  const sessionDefaultTtlHours = parseInt(env.SESSION_DEFAULT_TTL_HOURS ?? '24', 10);
  const sessionRememberTtlDays = parseInt(env.SESSION_REMEMBER_TTL_DAYS ?? '30', 10);

  const cookieSecure = env.AUTH_COOKIE_SECURE
    ? env.AUTH_COOKIE_SECURE.toLowerCase() === 'true'
    : isProd;

  const sameSiteRaw = (env.AUTH_COOKIE_SAMESITE ?? 'lax').toLowerCase();
  const cookieSameSite = (['lax', 'strict', 'none'].includes(sameSiteRaw)
    ? sameSiteRaw
    : 'lax') as 'lax' | 'strict' | 'none';

  return {
    privateKey,
    publicKey,
    issuer: env.JWT_ACCESS_ISSUER ?? 'bachina-labs-academy',
    audience: env.JWT_ACCESS_AUDIENCE ?? 'bachina-labs-academy-web',
    accessTtlSeconds,
    sessionDefaultTtlHours,
    sessionRememberTtlDays,
    cookieSecure,
    cookieSameSite,
    cookieDomain: env.AUTH_COOKIE_DOMAIN || undefined,
  };
}

export default registerAs('jwt', (): JwtConfig => buildJwtConfig(process.env));
