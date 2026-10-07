/**
 * Real browser E2E for the integrated frontend + backend.
 *
 * Drives the actual UI in headless Chromium, then cross-checks the durable state through the API
 * using the token the browser stored. It asserts: sign-up, the streamed chat reply is persisted,
 * `run.completed` events exist, a knowledge upload indexes to a terminal status, a deterministic
 * multi-turn conversation survives history validation, the session survives a reload, and there are
 * no runtime errors.
 *
 * Requires a running stack (api + worker-agent + postgres + temporal) and the Vite dev server:
 *
 *   cd web && npm run dev
 *   node ../scripts/e2e/run.mjs
 *
 * `playwright-core` and a Chromium binary are needed; override the binary with `CHROME_PATH`,
 * the app with `APP_URL`, the API with `API_URL`, and screenshots with `SHOTS_DIR`.
 */

import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.env.APP_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:8000/api/v1';
const CHROME =
  process.env.CHROME_PATH ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const SHOTS = process.env.SHOTS_DIR || join(tmpdir(), 'aether-e2e-shots');
mkdirSync(SHOTS, { recursive: true });

const email = `e2e_${Date.now()}@example.com`;
const password = 'swordfish-123';
const results = [];
let failed = false;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

async function api(path, token, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`);
  return body;
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

try {
  // --- A. load the app and sign up ---------------------------------------
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#auth-email', { timeout: 20000 });
  record('auth: login screen renders', true);
  await page.screenshot({ path: `${SHOTS}/01-login.png` });

  // Switch to sign-up (the toggle lives in the footer paragraph).
  await page.locator('p button').click();
  await page.waitForSelector('#auth-name', { timeout: 10000 });
  await page.fill('#auth-name', 'E2E Owner');
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', password);
  await page.fill('#auth-confirm', password);
  await page.locator('button[type=submit]').click();

  // --- B. workspace loads and persists a token ---------------------------
  await page.waitForSelector('textarea', { timeout: 30000 });
  await page.screenshot({ path: `${SHOTS}/02-workspace.png` });
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('aetheris:accessToken') ?? 'null'));
  record('auth: sign-up reaches the workspace', Boolean(token));
  if (!token) throw new Error('no access token stored after sign-up');

  // Seed bot is created for an empty workspace and shows up via the API.
  const bots = await api('/bots', token);
  record('bots: default assistant seeded', bots.length >= 1, `${bots.length} bot(s)`);

  // --- C. real chat turn with SSE streaming ------------------------------
  const latestRun = async () => (await api('/runs', token))[0];
  const sendTurn = async () => {
    await page.fill('textarea', 'Say hello in exactly three words.');
    await page.locator('button[title="Send"]').click();
    await page.waitForSelector('button[title="Stop"]', { timeout: 20000 });
    record('chat: streaming started (Stop button visible)', true);
    await page.waitForSelector('button[title="Send"]', { timeout: 90000 });
    return latestRun();
  };

  let run = await sendTurn();
  // The free provider occasionally rate-limits; the backend surfaces it as a classified failure.
  // Retry that specific case rather than treating an upstream blip as an integration failure.
  for (let attempt = 0; attempt < 2 && run.status !== 'succeeded'; attempt++) {
    if (!/rate|model|timeout/i.test(run.failure?.reason ?? '')) break;
    console.log(`    (provider said ${run.failure?.reason}; retrying in 15s)`);
    await page.waitForTimeout(15000);
    run = await sendTurn();
  }
  record('chat: streaming finished', true);
  record(
    'chat: run completed successfully',
    run.status === 'succeeded',
    `status=${run.status}${run.failure ? ` reason=${run.failure.reason}` : ''}`
  );
  await page.screenshot({ path: `${SHOTS}/03-chat-reply.png` });

  // Cross-check the durable conversation through the API.
  const conversations = await api('/conversations', token);
  record('chat: a conversation was created', conversations.length >= 1);
  const conversation = await api(`/conversations/${conversations[0].id}`, token);
  const botMessages = conversation.messages.filter((m) => m.sender === 'bot' && m.content.trim());
  record(
    'chat: assistant reply persisted',
    run.status === 'succeeded' ? botMessages.length >= 1 : true,
    botMessages.at(-1)?.content?.slice(0, 60) ?? run.failure?.message ?? 'none'
  );
  const events = await api(`/runs/${run.id}/events`, token);
  record(
    'runs: live events persisted with a terminal run.completed',
    run.status !== 'succeeded' || events.some((e) => e.type === 'run.completed'),
    `${events.length} events`
  );

  // --- D. bots section ---------------------------------------------------
  await page.locator('text=Bots').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/04-bots.png` });
  const botsHeading = await page.locator('body').innerText();
  record('bots: section renders', /Bots/.test(botsHeading));

  // --- E. knowledge upload ----------------------------------------------
  await page.locator('text=Knowledge').first().click();
  await page.waitForTimeout(500);
  const sample = join(SHOTS, 'sample.txt');
  writeFileSync(sample, 'Aether knowledge base sample.\n\nSecond paragraph about pricing.');
  await page.locator('input[type=file]').first().setInputFiles(sample);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/05-knowledge-uploading.png` });
  // Wait for the indexing workflow to finish (poll the API, up to ~30s).
  let knowledge = await api('/knowledge', token);
  record('knowledge: upload created a source', knowledge.length >= 1);
  for (let i = 0; i < 30; i++) {
    knowledge = await api('/knowledge', token);
    if (knowledge[0]?.status === 'Ready' || knowledge[0]?.status === 'Failed') break;
    await page.waitForTimeout(1000);
  }
  record(
    'knowledge: indexed to a terminal status',
    ['Ready', 'Failed'].includes(knowledge[0]?.status),
    `status=${knowledge[0]?.status} chunks=${knowledge[0]?.chunksCount}`
  );

  // --- F. tools section --------------------------------------------------
  await page.locator('text=Tools').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/06-tools.png` });
  record('tools: section renders', /Tools/.test(await page.locator('body').innerText()));

  // --- F2. multi-turn regression (deterministic bot, no model) -----------
  const waitRun = async (id, tokenValue) => {
    for (let i = 0; i < 40; i++) {
      const r = await api(`/runs/${id}`, tokenValue);
      if (['succeeded', 'failed', 'cancelled', 'timed_out'].includes(r.status)) return r;
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`run ${id} never terminated`);
  };
  const pingBot = await api('/bots', token, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Ping Bot',
      bot_type: 'simple',
      deterministic_rules: [{ trigger: 'ping', response: 'pong' }],
    }),
  });
  const pingConv = await api('/conversations', token, {
    method: 'POST',
    body: JSON.stringify({ bot_id: pingBot.id }),
  });
  const pingTurn = async (content) =>
    api(`/conversations/${pingConv.id}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  const first = await waitRun((await pingTurn('ping')).run_id, token);
  record('multi-turn: first deterministic turn succeeds', first.status === 'succeeded');
  const second = await waitRun((await pingTurn('ping')).run_id, token);
  record(
    'multi-turn: second turn survives history validation',
    second.status === 'succeeded',
    second.failure?.message ?? ''
  );

  // --- G. session persistence across reload ------------------------------
  await page.goto(`${APP}/#/chat`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('textarea', { timeout: 20000 });
  record('auth: session survives a reload', true);
  await page.screenshot({ path: `${SHOTS}/07-after-reload.png` });

  // --- H. no runtime errors ---------------------------------------------
  const realConsoleErrors = consoleErrors.filter(
    (e) => !/favicon|devtools|well-known|Failed to load resource/i.test(e)
  );
  record('runtime: no console errors', realConsoleErrors.length === 0, realConsoleErrors.join(' | '));
  record('runtime: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  record('harness: uncaught exception', false, String(error));
  try {
    await page.screenshot({ path: `${SHOTS}/99-failure.png` });
  } catch {
    /* ignore */
  }
} finally {
  await browser.close();
}

console.log('\n=== SUMMARY ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`\n${failed ? 'RESULT: FAIL' : 'RESULT: PASS'} (${results.filter((r) => r.ok).length}/${results.length})`);
process.exit(failed ? 1 : 0);
