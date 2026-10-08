/**
 * The TanStack Query layer: one client, one key factory, one set of options.
 *
 * Everything the app reads from the server is a query and everything it writes
 * is a mutation, so route loaders, components and the workspace store all share
 * a single cache instead of hand-rolled fetch-on-mount logic.
 *
 * The client is a module singleton on purpose: route loaders run outside React
 * and still need `ensureQueryData` to resolve a deep link before it renders.
 */

import { QueryClient } from '@tanstack/react-query';
import {
  ApiError,
  authApi,
  botsApi,
  conversationsApi,
  knowledgeApi,
  toolsApi,
  tokens,
} from './api';
import type { BotItem, KnowledgeItem, ToolItem } from '../types/agent';

export const queryKeys = {
  session: ['session'] as const,
  bots: ['bots'] as const,
  bot: (id: string) => ['bots', id] as const,
  tools: ['tools'] as const,
  knowledge: ['knowledge'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry an auth failure: the session query answers it by clearing
        // the session, and the route guard redirects.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

/** Seeds the session cache from an auth response, so guarded routes resolve warm. */
export function setSessionCache(data: SessionData): void {
  queryClient.setQueryData<SessionData | null, typeof queryKeys.session>(queryKeys.session, data);
}

/** Drops every cached response. Used on sign-out. */
export function resetQueryCache(): void {
  queryClient.clear();
}

// --- session --------------------------------------------------------------

export interface SessionData {
  user: { name: string; email: string };
  workspace: Awaited<ReturnType<typeof authApi.me>>['workspace'];
}

/**
 * The session is only queried when a token exists, so an anonymous visitor
 * resolves immediately instead of waiting for a request that would 401.
 */
export function fetchSession(): Promise<SessionData | null> {
  if (!tokens.access) return Promise.resolve(null);
  return authApi.me().then(
    (me) => ({ user: { name: me.user.name, email: me.user.email }, workspace: me.workspace }),
    () => {
      tokens.clear();
      return null;
    },
  );
}

// --- collections ----------------------------------------------------------

export async function fetchBots(): Promise<BotItem[]> {
  const bots = await botsApi.list();
  if (bots.length > 0) return bots;
  // A brand-new workspace still needs a bot to chat with; seed one default
  // simple deterministic bot (no model, no tools, no knowledge).
  return [
    await botsApi.create({
      name: 'Assistant',
      description: 'A deterministic rule-based assistant.',
      bot_type: 'simple',
      instructions: 'Deterministic condition-action rules without models, tools, or knowledge.',
      deterministic_rules: [
        { trigger: 'ping', response: 'pong! (Instant deterministic execution)' },
        { trigger: 'help', response: 'Available commands: ping, status, help' },
      ],
    }),
  ];
}

export const fetchTools = (): Promise<ToolItem[]> => toolsApi.list();

export const fetchKnowledge = (): Promise<KnowledgeItem[]> => knowledgeApi.list();

/** Knowledge is only worth polling while a source is still being indexed. */
export function hasPendingKnowledge(items: KnowledgeItem[] | undefined): boolean {
  return Boolean(
    items?.some(
      (item) => item.status === 'Uploading' || item.status === 'Processing' || item.status === 'Indexing',
    ),
  );
}

export async function fetchConversations() {
  const items = await conversationsApi.list();
  return items.map((c) => ({ ...c, messages: c.messages ?? [] }));
}

/** Resolves one bot, preferring the cached list and falling back to the endpoint. */
export async function fetchBot(botId: string): Promise<BotItem | undefined> {
  const cached = queryClient.getQueryData<BotItem[]>(queryKeys.bots);
  const known = cached?.find((b) => b.id === botId);
  if (known) return known;
  try {
    return await botsApi.get(botId);
  } catch (error) {
    // Only a definitive 404 means "this bot is gone". Anything else (network blip,
    // 5xx) must not be reported as a missing bot, or a transient failure would
    // silently throw the user back to the catalog instead of offering a retry.
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}
