/**
 * Entry point for the browser E2E suite.
 *
 * The suite itself lives in `web/e2e` and runs on the Playwright test runner
 * (`npm test` in `web/`, or `npx playwright test`). This script stays as a
 * convenience entry point so `node scripts/e2e/run.mjs` keeps working, and it is
 * deliberately thin: a second hand-rolled harness would only ever drift from the
 * real one.
 *
 * Requires the whole stack:
 *
 *   ./scripts/init.sh up && (cd web && npm run dev)
 *
 * Overrides: APP_URL, API_URL, CHROME_PATH, SHOTS_DIR (Playwright's outputDir).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..', '..', 'web');

if (!existsSync(join(web, 'node_modules', '@playwright', 'test'))) {
  console.error('Playwright is not installed. Run: cd web && npm install');
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync('npx', ['playwright', 'test', ...args], {
  cwd: web,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`Could not start the Playwright runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
