import { expect, test } from '@playwright/test';
import { createSimpleBot, createWorkspace, expectNoLatencyShown, getBot } from './helpers';

test.describe('bots catalog and navigation', () => {
  test('the catalog lists the seeded bot and opens its Overview', async ({ page, request }) => {
    await createWorkspace(page, request);

    await page.getByTestId('nav-bots').click();
    await expect(page.getByTestId('bot-card')).toHaveCount(1);

    await page.getByTestId('bot-card').getByRole('button', { name: /Studio/i }).click();
    await expect(page.getByTestId('bot-studio')).toBeVisible();
    await expect(page).toHaveURL(/\/bots\/.+\/studio$/);
  });

  test('card actions route to Overview and Studio, and both views are reachable from each other', async ({
    page,
    request,
  }) => {
    await createWorkspace(page, request);
    await page.getByTestId('nav-bots').click();

    await page.getByTestId('bot-card').getByRole('button', { name: /Overview/i }).click();
    await expect(page.getByTestId('bot-overview')).toBeVisible();
    await expect(page).toHaveURL(/\/bots\/.+\/overview$/);

    // Overview's single primary action moves to the Studio.
    await page.getByTestId('open-studio').click();
    await expect(page.getByTestId('bot-studio')).toBeVisible();
    await expect(page).toHaveURL(/\/bots\/.+\/studio$/);

    // And the Studio can go straight back, without an ambiguous "back" target.
    await page.getByTestId('bot-view-overview').click();
    await expect(page.getByTestId('bot-overview')).toBeVisible();
    await expect(page.getByTestId('bot-view-overview')).toHaveAttribute('aria-selected', 'true');

    // Repeated switching must stay on the same bot.
    for (let i = 0; i < 3; i += 1) {
      await page.getByTestId('bot-view-studio').click();
      await expect(page.getByTestId('bot-studio')).toBeVisible();
      await page.getByTestId('bot-view-overview').click();
      await expect(page.getByTestId('bot-overview')).toBeVisible();
    }
  });

  test('the header back control returns to the catalog and clears the URL', async ({ page, request }) => {
    await createWorkspace(page, request);
    await page.getByTestId('nav-bots').click();
    await page.getByTestId('bot-card').first().getByRole('button', { name: /Studio/i }).click();
    await expect(page.getByTestId('bot-studio')).toBeVisible();

    await page.getByTestId('bot-header').getByTitle(/All Bots/i).click();
    await expect(page.getByTestId('bot-card')).toHaveCount(1);
    await expect(page).toHaveURL(/\/bots$/);
  });

  test('both bot views are deep-linkable and survive a reload', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Deep Link Bot' });

    await page.goto(`/bots/${bot.id}/overview`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('bot-overview')).toBeVisible();
    await expect(page.getByTestId('bot-header')).toContainText('Deep Link Bot');

    await page.goto(`/bots/${bot.id}/studio`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('bot-studio')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('bot-studio')).toBeVisible();
  });

  test('browser back and forward move between catalog, overview and studio', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'History Bot' });

    await page.goto('/bots', { waitUntil: 'domcontentloaded' });
    // The workspace seeds one bot; this test added a second one.
    await expect(page.getByTestId('bot-card')).toHaveCount(2);

    await page.goto(`/bots/${bot.id}/overview`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('bot-overview')).toBeVisible();

    await page.getByTestId('open-studio').click();
    await expect(page.getByTestId('bot-studio')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('bot-overview')).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId('bot-studio')).toBeVisible();
  });

  test('an unknown bot id falls back to the catalog instead of a blank page', async ({ page, request }) => {
    await createWorkspace(page, request);
    await page.goto('/bots/00000000-0000-0000-0000-000000000000/studio', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('bot-card')).toHaveCount(1);
  });

  test('publishing a bot from the card is persisted', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const createdBotId = (await createSimpleBot(api, { name: 'Toggle Bot' })).id;

    const wasEnabled = (await getBot(api, createdBotId)).enabled;

    await page.getByTestId('nav-bots').click();
    // Target this bot's own card: the workspace also has a seeded bot, and the catalog
    // order is not something a test should depend on.
    const card = page.getByTestId('bot-card').filter({ hasText: 'Toggle Bot' });
    const toggle = card.locator('button[role=switch]');
    await expect(toggle).toHaveAttribute('aria-checked', String(wasEnabled));
    await toggle.click();

    // The switch must be persisted, not just optimistic UI.
    await expect
      .poll(async () => (await getBot(api, createdBotId)).enabled, { timeout: 15_000 })
      .toBe(!wasEnabled);

    // And it survives a reload, which is the point of persisting it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-bots').click();
    await expect(
      page.getByTestId('bot-card').filter({ hasText: 'Toggle Bot' }).locator('button[role=switch]')
    ).toHaveAttribute('aria-checked', String(!wasEnabled));
  });

  test('search and filters narrow the catalog', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    await createSimpleBot(api, { name: 'Support Agent', bot_type: 'agent' });
    await createSimpleBot(api, { name: 'Refund Rules' });

    await page.getByTestId('nav-bots').click();
    await expect(page.getByTestId('bot-card')).toHaveCount(3);

    await page.getByPlaceholder(/search/i).first().fill('refund');
    await expect(page.getByTestId('bot-card')).toHaveCount(1);
    await expect(page.getByTestId('bot-card').first()).toContainText('Refund Rules');

    await page.getByPlaceholder(/search/i).first().fill('');
    await page.getByTestId('bot-filter-agent').click();
    await expect(page.getByTestId('bot-card')).toHaveCount(1);
    await expect(page.getByTestId('bot-card').first()).toContainText('Support Agent');
  });

  test('no latency figure is rendered on any bot view', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Clean Report' });

    await page.getByTestId('nav-bots').click();
    await expectNoLatencyShown(page);

    await page.goto(`/bots/${bot.id}/overview`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('bot-overview')).toBeVisible();
    await expectNoLatencyShown(page);

    await page.getByTestId('bot-view-studio').click();
    await expect(page.getByTestId('bot-studio')).toBeVisible();
    await expectNoLatencyShown(page);

    for (const tab of ['build', 'configure'] as const) {
      await page.getByTestId(`studio-tab-${tab}`).click();
      await expectNoLatencyShown(page);
    }
  });

  test('the overview shows real run history instead of invented telemetry', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Run History Bot' });

    await page.goto(`/bots/${bot.id}/overview`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(new RegExp(`/bots/${bot.id}/overview`));
    await expect(page.getByTestId('bot-overview')).toBeVisible();
    await expect(page.getByTestId('no-runs')).toBeVisible();

    const run = await api.post(`/runs`, { bot_id: bot.id, input: 'ping' });
    expect(run.ok()).toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('run-row').first()).toBeVisible();
    await expect(page.getByTestId('run-row').first()).toContainText('ping');
  });

  test('the overview code section is collapsed until asked for', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    const bot = await createSimpleBot(api, { name: 'Code Bot' });

    await page.goto(`/bots/${bot.id}/overview`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('pre')).toHaveCount(0);

    await page.getByTestId('toggle-code').click();
    await expect(page.locator('pre')).toBeVisible();
    await expect(page.locator('pre')).toContainText('run_deterministic_bot');
  });
});
