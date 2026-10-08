import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Browser E2E for the integrated frontend + backend.
 *
 * The stack must be reachable: `./scripts/init.sh up` for api + workers + postgres +
 * temporal. This config starts the Vite dev server itself (and reuses one that is
 * already running), so a developer only has to bring the backend up.
 *
 * Browsers: Playwright downloads are blocked on some networks, so the launcher
 * falls back to any Chromium already present under `~/.cache/ms-playwright`.
 * Override explicitly with `CHROME_PATH`.
 */
function resolveChromium(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const cacheRoot = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;

  const revisions = readdirSync(cacheRoot)
    .filter((entry) => entry.startsWith('chromium-'))
    .sort()
    .reverse();

  for (const revision of revisions) {
    for (const flavour of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const candidate = join(cacheRoot, revision, flavour);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const executablePath = resolveChromium();

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // Every spec drives the real backend, so state leaks between workers are a bug,
  // not something to paper over: run serially against one stack.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './e2e/.artifacts',

  use: {
    baseURL: APP_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev',
    url: APP_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
