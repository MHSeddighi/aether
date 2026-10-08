import { expect, test } from '@playwright/test';
import { apiGet, buildTurn, createSimpleBot, createWorkspace, getBot, playgroundTurn } from './helpers';

/**
 * Opens a bot's Studio straight from a deep link and waits until the page is
 * actually showing that bot — the header is the cheapest proof that the routed
 * bot, the workspace selection and every action target agree.
 */
async function openStudio(page: import('@playwright/test').Page, bot: { id: string; name: string }) {
  await page.goto(`/bots/${bot.id}/studio`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('studio-playground')).toBeVisible();
  await expect(page.getByTestId('bot-header')).toContainText(bot.name);
}

test.describe('agent chat (studio)', () => {
  test('the playground answers deterministically, without a model call', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Playground Bot' });
    await openStudio(page, bot);

    const feed = page.getByTestId('studio-playground').getByTestId('message-feed');
    await expect(feed.getByTestId('message-bot').first()).toContainText('Playground Bot');

    const pingReply = await playgroundTurn(page, 'ping');
    expect(pingReply).toMatch(/pong/i);

    const statusReply = await playgroundTurn(page, 'status');
    expect(statusReply).toMatch(/operational/i);

    await expect(feed.getByTestId('message-user')).toHaveCount(2);
    await expect(feed.getByTestId('message-bot')).toHaveCount(3); // greeting + two answers

    // The runs really happened server-side.
    const runs = await apiGet<{ input: string; status: string }[]>(api, `/runs?bot_id=${bot.id}`);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((r) => r.status === 'succeeded')).toBeTruthy();
  });

  test('the playground keeps a multi-turn transcript and clears on demand', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Transcript Bot' });
    await openStudio(page, bot);

    await playgroundTurn(page, 'ping');
    await playgroundTurn(page, 'status');
    await playgroundTurn(page, 'ping');

    const feed = page.getByTestId('studio-playground').getByTestId('message-feed');
    await expect(feed.getByTestId('message-user')).toHaveCount(3);

    await page.getByTitle(/clear/i).first().click();
    await expect(feed.getByTestId('message-user')).toHaveCount(0);
  });

  test('an unknown trigger still returns a deterministic answer', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Fallback Bot' });
    await openStudio(page, bot);

    const reply = await playgroundTurn(page, 'something totally unexpected');
    expect(reply.length).toBeGreaterThan(0);
  });

  test('the playground composer is keyboard driven and blocks empty sends', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Keyboard Bot' });
    await openStudio(page, bot);

    await expect(page.getByTestId('playground-send')).toBeDisabled();

    await page.getByTestId('playground-input').fill('ping');
    await expect(page.getByTestId('playground-send')).toBeEnabled();
    await page.getByTestId('playground-input').press('Enter');

    await expect(
      page.getByTestId('studio-playground').getByTestId('message-bot').last()
    ).toContainText(/pong/i);
  });

  test('the Build tab refines the bot and persists the change', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Refine Bot' });
    await openStudio(page, bot);

    await page.getByTestId('studio-tab-build').click();
    await expect(page.getByTestId('studio-build')).toBeVisible();
    await expect(page.getByTestId('message-feed').first()).toContainText(/architecture agent/i);

    const before = await getBot(api, bot.id);
    const reply = await buildTurn(page, 'Make every answer strictly valid JSON');
    expect(reply).toMatch(/json/i);

    await expect
      .poll(async () => (await getBot(api, bot.id)).instructions, { timeout: 15_000 })
      .toContain('validated JSON schemas');

    const after = await getBot(api, bot.id);
    expect(after.instructions.length).toBeGreaterThan(before.instructions.length);
    expect(after.version).not.toBe(before.version);
  });

  test('the Build agent lowers temperature when asked to be brief', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Tone Bot', temperature: 0.8 });
    await openStudio(page, bot);

    await page.getByTestId('studio-tab-build').click();
    await buildTurn(page, 'Lower the temperature and keep it short');

    await expect
      .poll(async () => (await getBot(api, bot.id)).temperature, { timeout: 15_000 })
      .toBeLessThan(0.8);
    expect(bot.id).toBeTruthy();
  });

  test('the Build tab can be reset for the next request', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Reset Build Bot' });
    await openStudio(page, bot);

    await page.getByTestId('studio-tab-build').click();
    await buildTurn(page, 'Add a strict JSON formatting rule');
    await expect(page.getByTestId('message-user')).toHaveCount(1);

    await page.getByTestId('studio-build').getByTitle(/clear/i).click();
    await expect(page.getByTestId('studio-build').getByTestId('message-user')).toHaveCount(0);
  });

  test('Configure adds and removes deterministic rules, then saves them', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Rule Bot' });
    await openStudio(page, bot);

    await page.getByTestId('studio-tab-configure').click();
    const rules = page.getByTestId('rules-list');
    const initialCount = await rules.locator('> div').count();

    await page.getByTestId('new-rule-trigger').fill('refund');
    await page.getByTestId('new-rule-response').fill('Refunds are available within 7 days.');
    await page.getByTestId('add-rule').click();
    await expect(rules.locator('> div')).toHaveCount(initialCount + 1);
    await expect(rules).toContainText('refund');

    await page.getByTestId('save-changes').click();

    await expect
      .poll(
        async () =>
          (await getBot(api, bot.id)).deterministicRules.some((r) => r.trigger === 'refund'),
        { timeout: 15_000 }
      )
      .toBe(true);

    // The new trigger answers in the playground straight away.
    await page.getByTestId('studio-tab-chat').click();
    const reply = await playgroundTurn(page, 'refund');
    expect(reply).toMatch(/within 7 days/i);

    // Remove it again and save.
    await page.getByTestId('studio-tab-configure').click();
    await page.getByTestId('rules-list').getByTitle(/delete rule/i).last().click();
    await page.getByTestId('save-changes').click();

    await expect
      .poll(
        async () =>
          (await getBot(api, bot.id)).deterministicRules.some((r) => r.trigger === 'refund'),
        { timeout: 15_000 }
      )
      .toBe(false);
  });

  test('Configure shows the agent-only settings for an LLM bot and hides rule editing', async ({
    page,
    request,
  }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, {
      name: 'LLM Bot',
      bot_type: 'agent',
      provider: 'deepseek',
      model_id: 'deepseek-chat',
      instructions: 'Reply with exactly: PONG',
      deterministic_rules: [],
    });

    await page.goto(`/bots/${bot.id}/studio`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('studio-tab-configure').click();

    await expect(page.getByTestId('instructions-input')).toBeVisible();
    await expect(page.getByTestId('rules-list')).toHaveCount(0);
    await expect(page.getByTestId('instructions-input')).toHaveValue('Reply with exactly: PONG');

    await page.getByTestId('instructions-input').fill('Reply with exactly: PONG, and nothing else.');
    await page.getByTestId('save-changes').click();

    await expect
      .poll(
        async () => (await getBot(api, bot.id)).instructions,
        { timeout: 15_000 }
      )
      .toContain('nothing else');
  });

  test('a simple bot never shows model settings, an agent bot always does', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const simple = await createSimpleBot(api, { name: 'Rules Only' });
    const agent = await createSimpleBot(api, {
      name: 'Model Driven',
      bot_type: 'agent',
      provider: 'deepseek',
      model_id: 'deepseek-chat',
      deterministic_rules: [],
    });

    await page.goto(`/bots/${simple.id}/studio`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('studio-tab-configure').click();
    await expect(page.getByTestId('rules-list')).toBeVisible();
    await expect(page.getByTestId('instructions-input')).toHaveCount(0);

    await page.goto(`/bots/${agent.id}/studio`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('studio-tab-configure').click();
    await expect(page.getByTestId('instructions-input')).toBeVisible();
    await expect(page.getByTestId('rules-list')).toHaveCount(0);
  });

  test('each Studio tab keeps its own transcript', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Tab Isolation' });
    await openStudio(page, bot);

    await playgroundTurn(page, 'ping');
    await expect(
      page.getByTestId('studio-playground').getByTestId('message-user')
    ).toHaveCount(1);

    await page.getByTestId('studio-tab-build').click();
    await expect(page.getByTestId('studio-build').getByTestId('message-user')).toHaveCount(0);

    await page.getByTestId('studio-tab-chat').click();
    await expect(
      page.getByTestId('studio-playground').getByTestId('message-user')
    ).toHaveCount(1);
  });

  test('reopening a different bot does not leak the previous transcript', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const first = await createSimpleBot(api, { name: 'First Bot' });
    const second = await createSimpleBot(api, { name: 'Second Bot' });

    await openStudio(page, first);
    await playgroundTurn(page, 'ping');
    await expect(
      page.getByTestId('studio-playground').getByTestId('message-user')
    ).toHaveCount(1);

    await page.goto(`/bots/${second.id}/studio`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('studio-playground')).toBeVisible();
    await expect(
      page.getByTestId('studio-playground').getByTestId('message-user')
    ).toHaveCount(0);
    await expect(page.getByTestId('message-feed').first()).toContainText('Second Bot');
  });

  test('switching to Overview and back keeps the Studio open on the same tab', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Tab Memory' });
    await openStudio(page, bot);

    await page.getByTestId('studio-tab-configure').click();
    await page.getByTestId('bot-view-overview').click();
    await expect(page.getByTestId('bot-overview')).toBeVisible();

    await page.getByTestId('bot-view-studio').click();
    await expect(page.getByTestId('studio-tab-configure')).toHaveAttribute('aria-selected', 'true');
  });

  test('an unpublished bot refuses runs and says so in the transcript', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Unpublished Bot', enabled: false });
    await openStudio(page, bot);

    // The backend refuses runs for an unpublished bot (409). The playground must show
    // that reason rather than a stale or invented answer.
    const reply = await playgroundTurn(page, 'ping');
    expect(reply).toMatch(/disabled/i);

    // Publishing it makes the same prompt work.
    await page.getByTestId('bot-header').locator('button[role=switch]').click();
    await expect
      .poll(async () => (await getBot(api, bot.id)).enabled, { timeout: 15_000 })
      .toBe(true);

    await page.getByTestId('studio-tab-chat').click();
    expect(await playgroundTurn(page, 'ping')).toMatch(/pong/i);
  });

  test('creating a bot from the catalog lands in its Studio playground', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);

    await page.getByTestId('nav-bots').click();
    await page.getByTestId('create-simple-bot').click();

    await expect(page.getByTestId('studio-playground')).toBeVisible();
    await expect(page.getByTestId('bot-header')).toContainText('Static Rule Bot');

    const reply = await playgroundTurn(page, 'ping');
    expect(reply).toMatch(/pong/i);

    const bots = await apiGet<{ id: string; botType: string }[]>(api, '/bots');
    expect(bots).toHaveLength(2);
    expect(bots.every((b) => b.botType === 'simple')).toBeTruthy();
  });
});
