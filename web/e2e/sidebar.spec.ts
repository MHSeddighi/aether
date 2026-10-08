import { expect, test } from '@playwright/test';
import { createWorkspace, signUp } from './helpers';

test.describe('sidebar', () => {
  test('the profile is the signed-in account, never a hard-coded one', async ({ page, request }) => {
    const { email } = await createWorkspace(page, request);

    const profile = page.getByTestId('profile');
    await expect(profile).toBeVisible();
    await expect(page.getByTestId('profile-name')).toHaveText('E2E Owner');
    await expect(page.getByTestId('profile-email')).toHaveText(email);
    await expect(page.getByTestId('profile').locator('span').first()).toHaveText('EO');

    // The old hard-coded fixture identity must be gone from the bundle.
    await expect(page.locator('body')).not.toContainText('Alex Mercer');
    await expect(page.locator('body')).not.toContainText('agency.dev');
  });

  test('the profile follows the account that is signed in', async ({ page, request }) => {
    const first = await signUp(page, { name: 'Ada Lovelace' });
    await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
    await expect(page.getByTestId('profile')).toContainText(first.email);

    await page.getByTestId('sidebar-sign-out').click();
    await expect(page.locator('#auth-email')).toBeVisible();

    await signUp(page, { name: 'Grace Hopper' });
    await expect(page.getByTestId('profile-name')).toHaveText('Grace Hopper');
    await expect(page.getByTestId('profile-email')).not.toHaveText(first.email);
  });

  test('the profile opens the account settings', async ({ page, request }) => {
    await createWorkspace(page, request);
    await page.getByTestId('profile').click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('new conversation is a quiet action in the history header, not a primary button', async ({
    page,
    request,
  }) => {
    await createWorkspace(page, request);

    const newConversation = page.getByTestId('new-chat');
    await expect(newConversation).toBeVisible();
    await expect(newConversation).toHaveText('New Conversation');

    // It lives next to the History heading, so it must not be a full-width primary button.
    const box = await newConversation.boundingBox();
    const sidebar = await page.locator('aside').first().boundingBox();
    expect(box).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(box!.width).toBeLessThan(sidebar!.width * 0.75);
  });

  test('new conversation clears the transcript and returns to the chat', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);

    await page.locator('textarea').first().fill('Build a bot about invoices.');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-user').first()).toBeVisible();

    await page.getByTestId('new-chat').click();
    await expect(page.getByTestId('message-feed')).toHaveCount(0);
    await expect(page.locator('textarea').first()).toHaveValue('');

    // The conversation itself is untouched, only deselected.
    await expect(page.getByTestId('conversation-item')).toHaveCount(1);
    expect((await api.get('/conversations')).ok()).toBeTruthy();
  });

  test('history is filtered by All / Bots / Tools only', async ({ page, request }) => {
    await createWorkspace(page, request);

    for (const filter of ['all', 'bots', 'tools'] as const) {
      await expect(page.getByTestId(`history-filter-${filter}`)).toBeVisible();
    }
    // The "Chat" filter is gone: every conversation is a chat.
    await expect(page.getByTestId('history-filter-chat')).toHaveCount(0);
  });

  test('the product name is Aetheris and the mark is amber into blue', async ({ page, request }) => {
    await createWorkspace(page, request);

    const brand = page.getByTestId('sidebar-brand');
    await expect(brand).toHaveAttribute('title', 'Aetheris');
    await expect(brand).toHaveText('Aetheris');

    const mark = brand.locator('span').first();
    const gradient = await mark.getAttribute('class');
    expect(gradient).toContain('from-amber-400');
    expect(gradient).toContain('to-blue-600');
  });

  test('the brand goes home and the sections switch without a reload', async ({ page, request }) => {
    await createWorkspace(page, request);

    await page.getByTestId('nav-bots').click();
    await expect(page).toHaveURL(/\/bots$/);

    await page.getByTestId('sidebar-brand').click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.locator('textarea').first()).toBeVisible();
  });

  test('Tools and Knowledge stay disabled with a Coming soon state', async ({ page, request }) => {
    await createWorkspace(page, request);

    for (const section of ['tools', 'knowledge']) {
      const destination = page.getByTestId(`nav-${section}`);
      await expect(destination).toHaveAttribute('aria-disabled', 'true');
      await destination.click({ force: true });
      await expect(page.getByText(/Coming soon/i).first()).toBeVisible();
    }
  });
});
