import { registerAs } from '@nestjs/config';

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
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL environment variable is required but not set. ' +
        'Copy apps/api/.env.example to apps/api/.env and fill in the connection string.',
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
    // databaseUrl is intentionally not returned here —
    // Prisma reads DATABASE_URL directly from process.env.
    // Keeping it out of the config object prevents accidental exposure in logs.
  };
});
