/**
 * The backend data layer.
 *
 * One typed client, one place that knows the wire format. Every request goes through `request()`,
 * so auth, error normalisation and the one-shot token refresh are impossible to forget. Responses
 * are already the frontend's camelCase shapes (see `docs/api-contract.md`), except the auth
 * endpoints, which the backend emits in snake_case and this module normalises once.
 */

import type {
  AuthUser,
  BotItem,
  BotVersion,
  ChatConversation,
  ChatMessage,
  KnowledgeItem,
  RunEvent,
  RunRecord,
  ToolItem,
  WorkspaceAccount,
} from '../types/agent';
import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from './storage';

export const API_BASE = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'
).replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// --- token store ----------------------------------------------------------

let accessToken: string | null = readStorage<string | null>(STORAGE_KEYS.accessToken, null);
let refreshToken: string | null = readStorage<string | null>(STORAGE_KEYS.refreshToken, null);

export const tokens = {
  get access(): string | null {
    return accessToken;
  },
  get refresh(): string | null {
    return refreshToken;
  },
  set(pair: { accessToken: string; refreshToken: string }): void {
    accessToken = pair.accessToken;
    refreshToken = pair.refreshToken;
    writeStorage(STORAGE_KEYS.accessToken, accessToken);
    writeStorage(STORAGE_KEYS.refreshToken, refreshToken);
  },
  clear(): void {
    accessToken = null;
    refreshToken = null;
    removeStorage(STORAGE_KEYS.accessToken);
    removeStorage(STORAGE_KEYS.refreshToken);
  },
};

export function authHeaders(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

// --- request plumbing -----------------------------------------------------

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
  raw?: BodyInit;
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'internal_error';
  let message = `request failed with status ${response.status}`;
  let details: unknown = {};
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (payload?.error) {
      code = payload.error.code ?? code;
      message = payload.error.message ?? message;
      details = payload.error.details ?? {};
    }
  } catch {
    // A non-JSON error body (a proxy, a gateway timeout) keeps the status-based default.
  }
  return new ApiError(response.status, code, message, details);
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { access_token: string; refresh_token: string };
    tokens.set({ accessToken: payload.access_token, refreshToken: payload.refresh_token });
    return true;
  } catch {
    return false;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal, raw } = options;

  const send = async (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method,
      signal,
      headers: {
        ...(raw ? {} : { 'Content-Type': 'application/json' }),
        ...(auth ? authHeaders() : {}),
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });

  let response = await send();

  // A single token refresh, shared by concurrent 401s, then one retry.
  if (response.status === 401 && auth && refreshToken) {
    refreshInFlight = refreshInFlight ?? refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
    if (await refreshInFlight) {
      response = await send();
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --- auth -----------------------------------------------------------------

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
  workspace: WorkspaceAccount;
}

function normaliseAuth(payload: AuthResponse): {
  user: AuthUser;
  workspace: WorkspaceAccount;
  accessToken: string;
  refreshToken: string;
} {
  tokens.set({ accessToken: payload.access_token, refreshToken: payload.refresh_token });
  return {
    user: payload.user,
    workspace: payload.workspace,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
  };
}

export const authApi = {
  async register(input: {
    email: string;
    name: string;
    password: string;
    workspaceName?: string;
  }) {
    const payload = await request<AuthResponse>('/auth/register', {
      method: 'POST',
      auth: false,
      body: {
        email: input.email,
        name: input.name,
        password: input.password,
        workspace_name: input.workspaceName,
      },
    });
    return normaliseAuth(payload);
  },

  async login(input: { email: string; password: string }) {
    const payload = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      auth: false,
      body: input,
    });
    return normaliseAuth(payload);
  },

  async me(): Promise<{ user: AuthUser; workspace: WorkspaceAccount }> {
    return request('/auth/me');
  },

  async logout(): Promise<void> {
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      tokens.clear();
    }
  },
};

// --- bots -----------------------------------------------------------------

export interface BotWrite {
  name?: string;
  name_fa?: string;
  description?: string;
  description_fa?: string;
  avatar_icon?: string;
  avatar_bg?: string;
  bot_type?: 'agent' | 'simple';
  provider?: string;
  model_id?: string;
  instructions?: string;
  instructions_fa?: string;
  tool_ids?: string[];
  knowledge_ids?: string[];
  deterministic_rules?: { trigger: string; response: string }[];
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  status?: 'active' | 'draft' | 'archived';
  enabled?: boolean;
}

export const botsApi = {
  list: () => request<BotItem[]>('/bots'),
  create: (body: BotWrite) => request<BotItem>('/bots', { method: 'POST', body }),
  get: (id: string) => request<BotItem>(`/bots/${id}`),
  update: (id: string, body: BotWrite) => request<BotItem>(`/bots/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/bots/${id}`, { method: 'DELETE' }),
  versions: (id: string) => request<BotVersion[]>(`/bots/${id}/versions`),
};

// --- tools ----------------------------------------------------------------

export interface ToolWrite {
  name: string;
  name_fa?: string;
  purpose?: string;
  purpose_fa?: string;
  icon?: string;
  connection_state?: string;
  category?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  handler?: 'builtin' | 'http' | 'docker';
  handler_config?: Record<string, unknown>;
  timeout_seconds?: number;
  permissions?: string[];
}

export const toolsApi = {
  list: () => request<ToolItem[]>('/tools'),
  create: (body: ToolWrite) => request<ToolItem>('/tools', { method: 'POST', body }),
  update: (id: string, body: Partial<ToolWrite>) =>
    request<ToolItem>(`/tools/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/tools/${id}`, { method: 'DELETE' }),
};

// --- knowledge ------------------------------------------------------------

export const knowledgeApi = {
  list: () => request<KnowledgeItem[]>('/knowledge'),
  get: (id: string) => request<KnowledgeItem>(`/knowledge/${id}`),
  rename: (id: string, name: string) =>
    request<KnowledgeItem>(`/knowledge/${id}`, { method: 'PATCH', body: { name } }),
  remove: (id: string) => request<void>(`/knowledge/${id}`, { method: 'DELETE' }),
  async upload(files: File[]): Promise<KnowledgeItem[]> {
    const form = new FormData();
    files.forEach((file) => form.append('files', file, file.name));
    return request<KnowledgeItem[]>('/knowledge', { method: 'POST', raw: form });
  },
};

// --- conversations & runs -------------------------------------------------

export interface SendMessageResult {
  run_id: string;
  user_message: ChatMessage;
  assistant_message: ChatMessage;
}

export const conversationsApi = {
  list: () => request<ChatConversation[]>('/conversations'),
  create: (body: { bot_id: string; title?: string; mode?: string }) =>
    request<ChatConversation>('/conversations', { method: 'POST', body }),
  get: (id: string) => request<ChatConversation>(`/conversations/${id}`),
  update: (id: string, body: { title?: string; is_pinned?: boolean }) =>
    request<ChatConversation>(`/conversations/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/conversations/${id}`, { method: 'DELETE' }),
  sendMessage: (
    id: string,
    body: { content: string; attachments?: { name: string; size_formatted: string; type: string }[] },
  ) => request<SendMessageResult>(`/conversations/${id}/messages`, { method: 'POST', body }),
  feedback: (messageId: string, feedback: 'good' | 'bad') =>
    request<ChatMessage>(`/messages/${messageId}/feedback`, { method: 'POST', body: { feedback } }),
};

export const runsApi = {
  create: (body: { bot_id: string; input: string; conversation_id?: string; assistant_message_id?: string }) =>
    request<{ run_id: string; status: string }>('/runs', { method: 'POST', body }),
  get: (id: string) => request<RunRecord>(`/runs/${id}`),
  cancel: (id: string) => request<{ run_id: string; status: string }>(`/runs/${id}/cancel`, { method: 'POST' }),
  events: (id: string, afterSeq = 0) =>
    request<RunEvent[]>(`/runs/${id}/events?after_seq=${afterSeq}`),
};

export interface CatalogModel {
  provider: string;
  modelId: string;
  label: string;
  free?: boolean;
  contextWindow?: number | null;
}

export const modelsApi = {
  list: () => request<CatalogModel[]>('/models'),
};
