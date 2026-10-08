import { test, expect } from '@playwright/test';
import { APP_URL, signUp, uniqueEmail } from './helpers';

/**
 * Walks the whole product loop once, against the real backend:
 * describe -> build -> preview -> collapse -> refine.
 */
test('a bot is built, previewed and refined entirely inside one conversation', async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { email: uniqueEmail('studio'), name: 'Studio Owner' });

  // New chat opens on the empty prompt, not a dashboard.
  await expect(page.getByRole('heading', { name: /what do you want to build/i })).toBeVisible();
  await expect(page.getByTestId('bot-artifact')).toHaveCount(0);
  await expect(page.getByTestId('preview-panel')).toHaveCount(0);

  // The mode indicator is the only other chrome.
  await expect(page.getByTestId('mode-indicator')).toBeVisible();

  await page.getByTestId('studio-input').locator('textarea').fill(
    'Create a customer support bot that answers questions from our knowledge base. Be concise and friendly.'
  );
  await page.getByTestId('studio-input').locator('textarea').press('Enter');

  // The AI streams, then the artifact appears with a way in.
  const artifact = page.getByTestId('bot-artifact');
  await expect(artifact).toBeVisible({ timeout: 180_000 });
  await expect(artifact).toContainText(/Bot · (Draft|Ready|Published)/i);
  await expect(page.getByTestId('preview-bot')).toBeVisible();

  // Collapsed: chat only.
  await expect(page.getByTestId('preview-panel')).toHaveCount(0);

  // Expanded: chat + a live bot preview with the compact config.
  await page.getByTestId('preview-bot').click();
  const panel = page.getByTestId('preview-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('compact-config')).toBeVisible();
  await expect(page.getByTestId('config-instructions')).toBeVisible();
  await expect(page.getByTestId('config-model')).toBeVisible();

  // Every section is present. A fresh workspace has no tools or sources yet, so those sections
  // render their empty state rather than the picker.
  for (const section of ['Instructions', 'Model', 'Knowledge', 'Tools', 'Variables']) {
    await expect(panel.getByRole('heading', { name: section })).toBeVisible();
  }
  await expect(panel.getByText('No tools attached')).toBeVisible();

  // Collapse returns the conversation to the full width; the artifact is still there.
  await page.getByTestId('collapse-preview').click();
  await expect(page.getByTestId('preview-panel')).toHaveCount(0);
  await expect(artifact).toBeVisible();

  // Refine through the conversation, then re-open the preview to see it reflected.
  await page.getByTestId('studio-input').locator('textarea').fill('Make the bot much more concise.');
  await page.getByTestId('studio-input').locator('textarea').press('Enter');
  await expect(page.getByTestId('message-bot').last()).toContainText(/.+/s, { timeout: 180_000 });
  await expect(page.getByTestId('bot-artifact')).toBeVisible();

  await page.getByTestId('preview-bot').click();
  await expect(page.getByTestId('preview-panel')).toBeVisible();
  await expect(page.getByTestId('config-instructions')).toHaveValue(/./);
});

test('collapsing the preview never loses the bot', async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { email: uniqueEmail('collapse'), name: 'Collapse Owner' });

  await page.getByTestId('studio-input').locator('textarea').fill(
    'Build a simple pricing FAQ bot that answers questions about plans.'
  );
  await page.getByTestId('studio-input').locator('textarea').press('Enter');

  await expect(page.getByTestId('bot-artifact')).toBeVisible({ timeout: 180_000 });
  const name = (await page.getByTestId('bot-artifact').locator('p').first().innerText()).trim();

  for (let i = 0; i < 3; i += 1) {
    await page.getByTestId('preview-bot').click();
    await expect(page.getByTestId('preview-panel')).toBeVisible();
    await page.getByTestId('collapse-preview').click();
    await expect(page.getByTestId('preview-panel')).toHaveCount(0);
    await expect(page.getByTestId('bot-artifact')).toBeVisible();
    expect((await page.getByTestId('bot-artifact').locator('p').first().innerText()).trim()).toBe(name);
  }
});

test('New Chat starts a clean session rather than reusing the current bot', async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { email: uniqueEmail('newchat'), name: 'New Chat Owner' });

  await page.getByTestId('studio-input').locator('textarea').fill('Build an invoice reminder bot.');
  await page.getByTestId('studio-input').locator('textarea').press('Enter');
  await expect(page.getByTestId('bot-artifact')).toBeVisible({ timeout: 180_000 });

  await page.getByTestId('preview-bot').click();
  await expect(page.getByTestId('preview-panel')).toBeVisible();

  await page.goto(APP_URL + '/chat');
  await page.getByTestId('new-chat').click();

  // Blank canvas: no artifact, no preview, nothing carried over.
  await expect(page.getByRole('heading', { name: /what do you want to build/i })).toBeVisible();
  await expect(page.getByTestId('bot-artifact')).toHaveCount(0);
  await expect(page.getByTestId('preview-panel')).toHaveCount(0);
});