import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

/**
 * Recursively collect compiled test files (`*.test.js`) under `dir`.
 * Hand-rolled to avoid pulling in a `glob` runtime dependency (see `whoOwns.ts`
 * for the same convention applied elsewhere in this codebase).
 */
function collectTestFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    try {
      const files = collectTestFiles(testsRoot);
      files.forEach((file) => mocha.addFile(file));

      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
