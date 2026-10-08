import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API_BASE = process.env.API_URL || 'http://localhost:8000/api/v1';
export const APP_URL = process.env.APP_URL || 'http://localhost:3000';

export const PASSWORD = 'swordfish-123';

export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}@example.com`;
}

export interface Workspace {
  email: string;
  name: string;
  token: string;
}

/** The subset of the Playwright API client these tests need, with auth pre-attached. */
export interface AuthedApi {
  get(path: string): Promise<{ ok(): boolean; status(): number; json(): Promise<unknown> }>;
  post(path: string, data: unknown): Promise<{ ok(): boolean; status(): number; json(): Promise<unknown> }>;
  patch(path: string, data: unknown): Promise<{ ok(): boolean; status(): number; json(): Promise<unknown> }>;
  delete(path: string): Promise<{ ok(): boolean; status(): number; json(): Promise<unknown> }>;
}

/**
 * Register through the real UI and return the token the browser stored. Going
 * through the form (rather than the API) means the session/boot path the user
 * actually hits is exercised on every single test.
 */
export async function signUp(page: Page, overrides: Partial<Workspace> = {}): Promise<Workspace> {
  const email = overrides.email ?? uniqueEmail();
  const name = overrides.name ?? 'E2E Owner';

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-email').waitFor({ state: 'visible' });

  // The auth screen toggles between sign-in and sign-up from a footer button.
  const nameField = page.locator('#auth-name');
  if (!(await nameField.isVisible())) {
    await page.locator('p button').first().click();
    await nameField.waitFor({ state: 'visible' });
  }

  await page.fill('#auth-name', name);
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', PASSWORD);
  await page.fill('#auth-confirm', PASSWORD);
  await page.locator('button[type=submit]').click();

  await page.locator('textarea').first().waitFor({ state: 'visible' });

  // Wait for the post-sign-up navigation to settle, so a caller that immediately
  // deep-links somewhere else is not racing the router's redirect to /chat.
  await page.waitForURL(/\/chat$/, { timeout: 20_000 });

  const token = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('aetheris:accessToken') ?? 'null')
  );
  expect(token, 'the browser must persist an access token after sign-up').toBeTruthy();
  return { email, name, token };
}

/** A workspace signed up through the UI, plus an authenticated API client. */
export async function createWorkspace(
  page: Page,
  request: APIRequestContext
): Promise<Workspace & { api: AuthedApi }> {
  const workspace = await signUp(page);
  const headers = { Authorization: `Bearer ${workspace.token}` };
  return {
    ...workspace,
    api: {
      get: (path: string) => request.get(`${API_BASE}${path}`, { headers }),
      post: (path: string, data: unknown) => request.post(`${API_BASE}${path}`, { headers, data }),
      patch: (path: string, data: unknown) => request.patch(`${API_BASE}${path}`, { headers, data }),
      delete: (path: string) => request.delete(`${API_BASE}${path}`, { headers }),
    },
  };
}

/** Drops the local session and force-loads `route` from scratch. */
export async function returnToAuth(page: Page, route: '/login' | '/signup' = '/login'): Promise<void> {
  await page.evaluate(() => localStorage.clear());
  // about:blank forces a real document load, so the app re-boots instead of
  // keeping the in-memory session the way a client-side jump would.
  await page.goto('about:blank');
  await page.goto(`${APP_URL}${route}`, { waitUntil: 'domcontentloaded' });
}

/** Reads one bot by id — never by position, which silently tests the wrong bot. */
export async function getBot(api: AuthedApi, botId: string): Promise<ApiBot> {
  const bots = await apiGet<ApiBot[]>(api, '/bots');
  const bot = bots.find((b) => b.id === botId);
  expect(bot, `bot ${botId} should exist`).toBeTruthy();
  return bot!;
}

export async function apiGet<T>(api: AuthedApi, path: string): Promise<T> {
  const response = await api.get(path);
  expect(response.ok(), `GET ${path} -> ${response.status()}`).toBeTruthy();
  return (await response.json()) as T;
}

export async function apiPost<T>(api: AuthedApi, path: string, body: unknown): Promise<T> {
  const response = await api.post(path, body);
  expect(response.ok(), `POST ${path} -> ${response.status()}`).toBeTruthy();
  return (await response.json()) as T;
}

export interface ApiBot {
  id: string;
  name: string;
  botType: 'simple' | 'agent';
  enabled: boolean;
  version: string;
  instructions: string;
  temperature: number;
  deterministicRules: { trigger: string; response: string }[];
  toolIds: string[];
  knowledgeIds: string[];
  metrics: { totalRuns: number; avgLatencyMs: number; tokensConsumed: number; successRatePercent: number };
}

/** Create a bot straight through the API so tests do not depend on UI text. */
export async function createSimpleBot(
  api: AuthedApi,
  overrides: Partial<Record<string, unknown>> = {}
): Promise<ApiBot> {
  return apiPost<ApiBot>(api, '/bots', {
    name: 'Ping Bot',
    description: 'Answers ping and status checks.',
    bot_type: 'simple',
    instructions: 'Deterministic condition-action rules without models, tools, or knowledge.',
    deterministic_rules: [
      { trigger: 'ping', response: 'pong! (Instant deterministic execution)' },
      { trigger: 'status', response: 'All systems operational. Zero model dependencies.' },
    ],
    ...overrides,
  });
}

/** The main conversation transcript — the one the user reads while describing a bot. */
export const transcript = (page: Page) => page.getByTestId('transcript');

/**
 * Assistant answer bodies.
 *
 * `message-content` is only rendered once the answer actually has text, so counting these is
 * unambiguous — counting the `message-bot` articles instead would immediately match the previous
 * answer and make every "wait for the reply" assertion pass instantly.
 */
export const answerBodies = (page: Page) => transcript(page).locator('[data-testid=message-content]');

/** Waits for the current transcript's last reply (used when nothing was sent). */
export async function waitForAssistantReply(page: Page): Promise<string> {
  const content = answerBodies(page).last();
  await expect(content).toBeVisible({ timeout: 60_000 });
  await expect(content).not.toHaveText(/^\s*$/, { timeout: 60_000 });
  return (await content.innerText()).trim();
}

/**
 * Sends one message through the main chat composer and waits for the answer.
 *
 * Scoped to `studio-input` because the preview panel renders a second composer whenever it is open,
 * and `composer-input` is deliberately a shared id across both.
 */
export async function chatTurn(page: Page, prompt: string): Promise<string> {
  const bodies = answerBodies(page);
  const before = await bodies.count();

  await page.getByTestId('studio-input').getByTestId('composer-input').fill(prompt);
  await page.getByTestId('studio-input').getByTestId('composer-send').click();

  await expect(bodies).toHaveCount(before + 1, { timeout: 90_000 });
  const last = bodies.last();
  await expect(last).not.toHaveText(/^\s*$/, { timeout: 90_000 });
  return (await last.innerText()).trim();
}

/** Sends through the preview panel's own composer, scoped so the two composers never mix. */
export async function previewTurn(page: Page, prompt: string): Promise<string> {
  const messages = page.getByTestId('preview-transcript').getByTestId('preview-message');
  const before = await messages.count();

  await page.getByTestId('preview-input').getByTestId('composer-input').fill(prompt);
  await page.getByTestId('preview-input').getByTestId('composer-send').click();

  await expect(messages).toHaveCount(before + 2, { timeout: 90_000 });
  return (await messages.last().innerText()).trim();
}

/** Runs one message through the Studio Playground and waits for the bot's answer. */
export async function playgroundTurn(page: Page, prompt: string): Promise<string> {
  return sendAndWaitReply(page.getByTestId('studio-playground').getByTestId('message-feed'), async () => {
    await page.getByTestId('playground-input').fill(prompt);
    await page.getByTestId('playground-send').click();
  });
}

/** Sends one instruction to the Studio Build agent and waits for its confirmation. */
export async function buildTurn(page: Page, prompt: string): Promise<string> {
  return sendAndWaitReply(page.getByTestId('studio-build').getByTestId('message-feed'), async () => {
    await page.getByTestId('build-input').fill(prompt);
    await page.getByTestId('build-send').click();
  });
}

/** Asserts that no latency/timing figure is rendered anywhere on the page. */
export async function expectNoLatencyShown(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  const offenders = text
    .split('\n')
    .filter((line) => /\b\d+(\.\d+)?\s*ms\b|\blatency\b|\bp99\b/i.test(line));
  expect(offenders, `latency must not be surfaced in the UI, found: ${offenders.join(' / ')}`).toHaveLength(0);
}
