import { expect, test } from '@playwright/test';
import {
  apiGet,
  chatTurn,
  createSimpleBot,
  createWorkspace,
  expectNoLatencyShown,
  signUp,
  waitForAssistantReply,
} from './helpers';

test.describe('chatbot', () => {
  test('a new-chat prompt creates the bot, answers in place and offers the Studio', async ({
    page,
    request,
  }) => {
    const { token, api } = await createWorkspace(page, request);

    const prompt = 'Build a health bot that answers ping and status checks.';
    await page.locator('textarea').first().fill(prompt);
    await page.getByTestId('chat-send').click();

    // 1. The answer arrives as a real conversation message, without leaving the chat.
    await expect(page.getByTestId('message-feed')).toBeVisible();
    const reply = await waitForAssistantReply(page, page.getByTestId('message-feed'));
    expect(reply.length).toBeGreaterThan(0);

    // 2. The bot was persisted through the API.
    const bots = await apiGet<{ id: string; name: string; botType: string }[]>(api, '/bots');
    const created = bots.find((b) => b.name.includes('health bot'));
    expect(created, 'the prompt must create a bot through the backend').toBeTruthy();
    expect(created!.botType).toBe('simple');

    // 3. Navigating to the Studio is offered, never forced.
    const offer = page.getByTestId('bot-offer');
    await expect(offer).toBeVisible();
    await expect(page.getByTestId('bot-studio')).toHaveCount(0);
    await expect(page.getByTestId('chat-send')).toBeVisible();

    // 4. The conversation is durable, so the prompt is not lost either way.
    // The list endpoint omits messages; the detail endpoint is the durable record.
    const conversations = await apiGet<{ id: string; botId: string }[]>(api, '/conversations');
    const conversation = conversations.find((c) => c.botId === created!.id);
    expect(conversation, 'the new-chat prompt must open a real conversation').toBeTruthy();
    const stored = await apiGet<{ messages: { sender: string }[] }>(api, `/conversations/${conversation!.id}`);
    expect(stored.messages.map((m) => m.sender)).toEqual(['user', 'bot']);
    expect(token).toBeTruthy();
  });

  test('dismissing the offer keeps the chat and its history intact', async ({ page, request }) => {
    await createWorkspace(page, request);

    await chatTurn(page, 'Build a refund policy bot.');
    await expect(page.getByTestId('bot-offer')).toBeVisible();

    await page.getByTestId('bot-offer-dismiss').click();
    await expect(page.getByTestId('bot-offer')).toHaveCount(0);

    // Still in the chat, still holding the whole exchange.
    await expect(page.getByTestId('message-feed')).toBeVisible();
    await expect(page.getByTestId('message-user').first()).toContainText('refund policy bot');
    await expect(page.getByTestId('message-bot').first()).not.toBeEmpty();
    await expect(page.getByTestId('bot-studio')).toHaveCount(0);
  });

  test('accepting the offer opens the Studio and returning keeps the chat history', async ({
    page,
    request,
  }) => {
    await createWorkspace(page, request);

    await chatTurn(page, 'Build a pricing bot.');
    await page.getByTestId('bot-offer-open').click();

    const studio = page.getByTestId('bot-studio');
    await expect(studio).toBeVisible();
    await expect(studio).toContainText('pricing bot');

    // Navigating back to the chat must not lose the conversation.
    await page.getByTestId('nav-chat').click();
    await expect(page.getByTestId('message-feed')).toBeVisible();
    await expect(page.getByTestId('message-user').first()).toContainText('pricing bot');
    await expect(page.getByTestId('message-bot').first()).not.toBeEmpty();
  });

  test('multi-turn chat keeps every message in one conversation, across a reload', async ({
    page,
    request,
  }) => {
    const { api } = await createWorkspace(page, request);

    await chatTurn(page, 'Build a bot for billing questions.');
    await chatTurn(page, 'ping');
    await chatTurn(page, 'status');

    const feed = page.getByTestId('message-feed');
    await expect(feed.getByTestId('message-user')).toHaveCount(3);
    await expect(feed.getByTestId('message-bot')).toHaveCount(3);
    // Assert on the message body, not the bubble: the bubble also carries the sender
    // header and the "streaming" placeholder.
    const replies = feed.locator('[data-testid=message-bot] [data-testid=message-content]');
    // A bubble exists before its text does, so wait for the three answers themselves.
    await expect(replies).toHaveCount(3, { timeout: 30_000 });
    // Deterministic rules, so "ping" must map to a pong-style answer.
    await expect(replies.nth(1)).toContainText(/pong/i);

    // The whole exchange is durable, not just what is on screen.
    const conversations = await apiGet<{ id: string }[]>(api, '/conversations');
    expect(conversations).toHaveLength(1);
    const stored = await apiGet<{ messages: { sender: string; content: string }[] }>(
      api,
      `/conversations/${conversations[0].id}`
    );
    expect(stored.messages).toHaveLength(6);
    expect(stored.messages.filter((m) => m.sender === 'user').map((m) => m.content)).toEqual([
      'Build a bot for billing questions.',
      'ping',
      'status',
    ]);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('conversation-item').first().click();
    await expect(feed.getByTestId('message-user')).toHaveCount(3);
    await expect(feed.getByTestId('message-bot')).toHaveCount(3);
  });

  test('new chat resets the composer and the previous conversation stays in history', async ({
    page,
    request,
  }) => {
    await createWorkspace(page, request);
    await chatTurn(page, 'Build a shipping bot.');
    await expect(page.getByTestId('conversation-item')).toHaveCount(1);

    await page.getByTestId('new-chat').click();

    // Back on the empty home screen: no transcript, empty composer.
    await expect(page.getByTestId('message-feed')).toHaveCount(0);
    await expect(page.locator('textarea').first()).toHaveValue('');
    await expect(page.getByTestId('conversation-item')).toHaveCount(1);

    // The old conversation is still reachable.
    await page.getByTestId('conversation-item').first().click();
    await expect(page.getByTestId('message-user').first()).toContainText('shipping bot');
  });

  test('a conversation can be renamed and deleted, and both hit the API', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);
    await chatTurn(page, 'Build a bot about invoices.');

    const row = page.getByTestId('conversation-item').first();
    await row.hover();
    await row.getByTitle(/rename/i).click();
    await page.getByTestId('conversation-rename-input').fill('Invoices bot');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('conversation-item').first()).toContainText('Invoices bot');

    await expect
      .poll(async () => (await apiGet<{ title: string }[]>(api, '/conversations'))[0]?.title, { timeout: 15_000 })
      .toBe('Invoices bot');

    await row.hover();
    await row.getByTestId('conversation-delete').click();
    await expect(page.getByTestId('conversation-item')).toHaveCount(0);

    await expect
      .poll(async () => (await apiGet<unknown[]>(api, '/conversations')).length, { timeout: 15_000 })
      .toBe(0);
  });

  test('the send control points up and is never mirrored', async ({ page, request }) => {
    await createWorkspace(page, request);

    const send = page.getByTestId('chat-send');
    await expect(send.locator('svg.lucide-arrow-up')).toHaveCount(1);
    await expect(send.locator('svg.lucide-send')).toHaveCount(0);
    // A rotated paper plane was the old behaviour; no rotation may survive.
    expect(await send.locator('[class*="rotate"]').count()).toBe(0);
  });

  test('the composer is keyboard driven and refuses to send an empty prompt', async ({ page, request }) => {
    await createWorkspace(page, request);

    const composer = page.locator('textarea').first();
    await expect(page.getByTestId('chat-send')).toBeDisabled();

    await composer.fill('Build a bot for uptime checks.');
    await expect(page.getByTestId('chat-send')).toBeEnabled();

    await composer.press('Enter');
    await expect(page.getByTestId('message-user').first()).toContainText('uptime checks');
    await expect(page.getByTestId('message-feed')).toBeVisible();
  });

  test('the header opens the Studio for the chat bot without losing the transcript', async ({
    page,
    request,
  }) => {
    await createWorkspace(page, request);
    await chatTurn(page, 'Build a bot about refunds.');

    await page.locator('header button').filter({ hasText: /Open in Studio/i }).first().click();
    await expect(page.getByTestId('bot-studio')).toBeVisible();

    await page.getByTestId('nav-chat').click();
    await expect(page.getByTestId('message-user').first()).toContainText('refunds');
  });

  test('no latency figure is rendered anywhere in the chat', async ({ page, request }) => {
    await createWorkspace(page, request);
    await chatTurn(page, 'Build a status bot.');
    await expectNoLatencyShown(page);
  });

  test('attaching a file keeps it in the composer until it is removed', async ({ page, request }) => {
    await createWorkspace(page, request);

    const composer = page.getByTestId('composer').first();
    await composer.locator('input[type=file]').setInputFiles({
      name: 'spec.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# rules'),
    });
    await expect(composer).toContainText('spec.md');

    await composer.getByTitle(/clear/i).first().click();
    await expect(composer).not.toContainText('spec.md');
  });

  test('an empty workspace is seeded with a deterministic bot the chat can use', async ({
    page,
    request,
  }) => {
    const { api } = await createWorkspace(page, request);

    // Seeding happens on first load, so it may still be in flight when the test looks.
    await expect
      .poll(async () => (await apiGet<{ id: string }[]>(api, '/bots')).length, { timeout: 20_000 })
      .toBe(1);
    const bots = await apiGet<{ botType: string; deterministicRules: unknown[] }[]>(api, '/bots');
    expect(bots[0].botType).toBe('simple');
    expect(bots[0].deterministicRules.length).toBeGreaterThan(0);
  });

  test('the bot a prompt creates answers that same prompt', async ({ page, request }) => {
    const { api } = await createWorkspace(page, request);

    // In simple-bot mode the first prompt *is* the bot definition, and the chat stays
    // in the conversation it just opened (the Studio is an optional follow-up).
    const reply = await chatTurn(page, 'refunds are handled within 7 days');
    expect(reply).toMatch(/refunds are handled within 7 days/i);

    const created = (await apiGet<{ name: string; botType: string; deterministicRules: { trigger: string }[] }[]>(
      api,
      '/bots'
    )).find((b) => b.name.includes('refunds are handled'));
    expect(created, 'the prompt must produce a bot').toBeTruthy();
    expect(created!.deterministicRules.some((r) => r.trigger === 'refunds')).toBeTruthy();
  });

  test('the run stream is actually parsed in the browser', async ({ page, request }) => {
    /**
     * The UI recovers from a lost stream through the post-run refetch, so a broken
     * parser is invisible on screen: the answer still appears, just never live. This
     * tees the response and counts the frames the page really received.
     */
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __sseEvents: string[] }).__sseEvents = seen;
      const original = window.fetch.bind(window);
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        const url = String(args[0]);
        if (!url.includes('/stream') || !response.body) return response;
        const [forTest, forApp] = response.body.tee();
        void (async () => {
          const reader = forTest.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const match of decoder.decode(value).matchAll(/event: (\S+)/g)) seen.push(match[1]);
          }
        })();
        return new Response(forApp, { status: response.status, headers: response.headers });
      };
    });

    await createWorkspace(page, request);
    await chatTurn(page, 'Build a bot for streaming checks.');

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __sseEvents: string[] }).__sseEvents), {
        timeout: 30_000,
      })
      .toContain('run.completed');
  });

  test('signing out clears the session and signing back in restores the history', async ({ page, request }) => {
    const { email, api } = await createWorkspace(page, request);
    await chatTurn(page, 'Build a bot for delivery slots.');

    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: /sign out|log out/i }).first().click();
    await expect(page.locator('#auth-email')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('aetheris:accessToken'))).toBeNull();

    // The account keeps its data; only the local session was dropped.
    expect((await apiGet<unknown[]>(api, '/conversations')).length).toBe(1);

    await page.fill('#auth-email', email);
    await page.fill('#auth-password', 'swordfish-123');
    await page.locator('button[type=submit]').click();

    await page.getByTestId('conversation-item').first().click();
    await expect(page.getByTestId('message-user').first()).toContainText('delivery slots');
  });
});
