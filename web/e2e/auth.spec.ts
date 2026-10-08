import { expect, test } from '@playwright/test';
import { API_BASE, APP_URL, PASSWORD, returnToAuth, signUp, uniqueEmail } from './helpers';

test.describe('authentication', () => {
  test('the login screen renders scrollable, bordered fields', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

    const email = page.locator('#auth-email');
    await expect(email).toBeVisible();

    const field = await email.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { border: style.borderTopWidth, height: rect.height };
    });
    expect(parseFloat(field.border)).toBeGreaterThan(0);
    expect(field.height).toBeGreaterThan(0);

    const scrollHost = await page.evaluate(() => {
      const host = Array.from(document.querySelectorAll('div')).find(
        (d) => getComputedStyle(d).overflowY === 'auto'
      );
      return host ? { scroll: host.scrollHeight, client: host.clientHeight } : null;
    });
    expect(scrollHost).not.toBeNull();
  });

  test('sign-up reaches the workspace and stores a session', async ({ page }) => {
    const { email, token } = await signUp(page);
    expect(token).toBeTruthy();

    await expect(page.locator('textarea').first()).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('textarea').first()).toBeVisible();
    expect(email).toContain('@example.com');
  });

  test('signing in with the same credentials works and the session survives a reload', async ({
    page,
    request,
  }) => {
    const { email, token } = await signUp(page);

    // Clean slate, then sign back in through the form.
    await returnToAuth(page, '/login');
    await page.locator('#auth-email').waitFor({ state: 'visible' });

    await page.fill('#auth-email', email);
    await page.fill('#auth-password', PASSWORD);
    await page.locator('button[type=submit]').click();
    await expect(page.locator('textarea').first()).toBeVisible();

    const newToken = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('aetheris:accessToken') ?? 'null')
    );
    expect(newToken).toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('textarea').first()).toBeVisible();

    // The token minted for the second session is a real, working API credential.
    const me = await request.get(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    expect(me.ok()).toBeTruthy();
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email);
    expect(token).toBeTruthy();
  });

  test('wrong credentials surface an error and do not enter the workspace', async ({ page }) => {
    await page.goto(`${APP_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('#auth-email').waitFor({ state: 'visible' });
    await page.locator('#auth-email').fill(uniqueEmail('nobody'));
    await page.locator('#auth-password').fill('definitely-wrong');
    await page.locator('button[type=submit]').click();

    await expect(page.locator('body')).toContainText(/invalid|incorrect|wrong|failed/i);
    await expect(page.locator('textarea')).toHaveCount(0);
  });

  test('a duplicate e-mail cannot register twice', async ({ page }) => {
    const email = uniqueEmail('dupe');
    await signUp(page, { email });

    await returnToAuth(page, '/signup');
    await page.locator('#auth-name').waitFor({ state: 'visible' });
    await page.fill('#auth-name', 'Second Try');
    await page.fill('#auth-email', email);
    await page.fill('#auth-password', PASSWORD);
    await page.fill('#auth-confirm', PASSWORD);
    await page.locator('button[type=submit]').click();

    await expect(page.locator('body')).toContainText(/exists|already|taken|conflict/i);
  });
});
