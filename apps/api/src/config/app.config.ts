import { registerAs } from '@nestjs/config';
import { validateTrustProxy } from '../common/utils/client-ip.util';

/**
 * Application configuration factory.
 *
 * Values are read from environment variables with safe defaults for non-sensitive settings.
 * DATABASE_URL is required — a missing value will cause a clear startup failure
 * rather than a silent misconfiguration.
 *
 * Never commit real values — use .env (gitignored) for local development.
 */
export default registerAs('app', () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl || databaseUrl.trim() === '') {
    throw new Error(
      'DATABASE_URL environment variable is required but not set. ' +
        'Copy apps/api/.env.example to apps/api/.env and fill in the connection string.',
    );
  }

  const databaseRuntimeUrl = process.env['DATABASE_RUNTIME_URL'];
  if (!databaseRuntimeUrl || databaseRuntimeUrl.trim() === '') {
    throw new Error(
      'DATABASE_RUNTIME_URL environment variable is required for application runtime but was not set or is empty. ' +
        'Privileged fallback to DATABASE_URL is strictly prohibited.',
    );
  }

  return {
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    apiPrefix: 'api/v1',
    corsAllowedOrigins: (
      process.env['CORS_ALLOWED_ORIGINS'] ?? 'http://localhost:4200'
    )
      .split(',')
      .map((o) => o.trim()),
    trustProxy: validateTrustProxy(process.env['TRUST_PROXY']),
    serviceName: process.env['SERVICE_NAME'] ?? 'bachina-labs-api',
    logLevel: process.env['LOG_LEVEL'] ?? (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug'),
    logHealthChecks: process.env['LOG_HEALTH_CHECKS'] ?? 'debug',
    // databaseUrl is intentionally not returned here —
    // Prisma reads DATABASE_URL directly from process.env.
    // Keeping it out of the config object prevents accidental exposure in logs.
  };
});
