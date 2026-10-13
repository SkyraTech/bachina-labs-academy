import { registerAs } from '@nestjs/config';

/**
 * Application configuration factory.
 * Values are read from environment variables with safe defaults.
 * Never commit real values — use .env.local or environment secrets.
 */
export default registerAs('app', () => ({
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  apiPrefix: 'api/v1',
  corsAllowedOrigins: (process.env['CORS_ALLOWED_ORIGINS'] ?? 'http://localhost:4200')
    .split(',')
    .map((o) => o.trim()),
  databaseUrl: process.env['DATABASE_URL'],
}));
