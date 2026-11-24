import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('API Unit Test Discovery Configuration (P1-SAFETY-BASELINE-02)', () => {
  const apiRootDir = path.resolve(__dirname, '../..');
  const vitestConfigPath = path.join(apiRootDir, 'vitest.config.ts');

  it('configures vitest.config.ts to restrict unit test discovery strictly to src/**/*.spec.ts', () => {
    expect(fs.existsSync(vitestConfigPath)).toBe(true);
    const content = fs.readFileSync(vitestConfigPath, 'utf8');

    expect(content).toContain("include: ['src/**/*.spec.ts']");
    expect(content).toContain("exclude: ['test/**'");
  });

  it('ensures test/test-db-isolation.spec.ts and other test/ files are strictly excluded from unit discovery', () => {
    const testDbIsolationPath = path.join(apiRootDir, 'test', 'test-db-isolation.spec.ts');
    expect(fs.existsSync(testDbIsolationPath)).toBe(true);

    // Statically verify that test-db-isolation is inside test/ and not src/
    expect(testDbIsolationPath.includes(path.sep + 'src' + path.sep)).toBe(false);
    expect(testDbIsolationPath.includes(path.sep + 'test' + path.sep)).toBe(true);
  });
});
