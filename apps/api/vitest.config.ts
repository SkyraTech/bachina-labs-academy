import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Vitest's 5s default is too tight for this suite. Each spec builds a real
    // Nest TestingModule, and Test.compile() pays one-off reflection/DI cost
    // on its first use inside a worker. Under full parallel load (14 files)
    // that first compile can exceed 5s and fail a test whose actual logic
    // finishes in microseconds — a false negative, not a hang.
    //
    // These tests perform no I/O (Prisma, SMTP and the Resend SDK are all
    // mocked), so a genuinely stuck test still fails loudly, just at a higher
    // threshold.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
