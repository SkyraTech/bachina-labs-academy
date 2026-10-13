// scripts/write-dist-type.mjs
// Writes {"type":"module"} into dist/ so Node treats compiled ESM output correctly.
// Called by the postbuild npm script in package.json.
import { writeFileSync, existsSync, mkdirSync } from 'fs';

const distDir = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

writeFileSync(`${distDir}/package.json`, JSON.stringify({ type: 'module' }, null, 2));
console.log('✓ Written dist/package.json with {"type":"module"}');
