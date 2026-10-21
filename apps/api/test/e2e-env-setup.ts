import fs from 'node:fs';
import path from 'node:path';

const tempFile = path.resolve(process.cwd(), '.test-runtime-db.json');
if (fs.existsSync(tempFile)) {
  try {
    const data = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
    if (data.runtimeUrl) {
      process.env.DATABASE_RUNTIME_URL = data.runtimeUrl;
    }
    if (data.devUrl) {
      process.env.DATABASE_URL = data.devUrl;
    }
  } catch {
    // Ignore read errors
  }
}
