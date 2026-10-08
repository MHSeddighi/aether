import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
  useMemo,
  useCallback,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArtifactStatus,
  BotItem,
  BotVariable,
  ToolItem,
  KnowledgeItem,
  ChatConversation,
  ChatMessage,
  WorkspaceAccount,
  RunEvent,
} from '../types/agent';
import { SupportedLocale, translations, Translations } from '../lib/i18n/translations';
import {
  generateMaterial3ThemeTokens,
  applyThemeTokensToDocument,
  ThemeMode,
} from '../lib/theme/themeEngine';
import { readStorage, writeStorage, STORAGE_KEYS } from '../lib/storage';
import {
  fetchBots,
  fetchConversations,
  fetchKnowledge,
  fetchSession,
  fetchTools,
  hasPendingKnowledge,
  queryKeys,
  resetQueryCache,
  setSessionCache,
  type SessionData,
} from '../lib/queries';
import {
  ApiError,
  authApi,
  botsApi,
  BotWrite,
  conversationsApi,
  knowledgeApi,
  runsApi,
  toolsApi,
  ToolWrite,
  tokens,
} from '../lib/api';
import { subscribeToRun, RunStream } from '../lib/sse';
import {
  ProgressStep,
  finishProgress,
  reduceProgress,
} from '../components/chat/stages';

export type MainSection = 'chat' | 'bots' | 'tools' | 'knowledge' | 'settings';

/**
 * A bot that was just created (or deployed) from a chat. The chat keeps it as a
 * dismissible offer instead of navigating away, so the conversation — and the
 * user prompt that produced the bot — is never thrown away.
 */
export interface PendingBotOffer {
  botId: string;
  nonce: number;
}
export type ChatMode = 'chat' | 'bot-generation';
export type AgentMode = 'agent-bot' | 'simple-bot';

interface WorkspaceContextType {
  // Auth
  isAuthenticated: boolean;
  session: { name: string; email: string } | null;
  /** Initials + display name for the sidebar profile, derived from the session. */
  profile: { name: string; email: string; initials: string; firstName: string };
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, name: string, password: string) => Promise<void>;
  signOut: () => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  isMobileDrawerOpen: boolean;
  setIsMobileDrawerOpen: (open: boolean) => void;

  // Locale & i18n
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: Translations;
  isRTL: boolean;

  // Theming & Material 3
  themePresetId: string;
  setThemePresetId: (id: string) => void;
  customPrimaryColor: string;
  setCustomPrimaryColor: (hex: string) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;

  // Agent Input Modes (Bot Building vs Tool Building)
  agentMode: AgentMode;
  setAgentMode: (mode: AgentMode) => void;

  // Chat & Bot Generation via Agent
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;
  startBotGenerationChat: () => void;
  editingBotInChat: BotItem | null;
  setEditingBotInChat: (bot: BotItem | null) => void;
  confirmAndDeployBot: (proposed: Partial<BotItem>) => Promise<BotItem>;
  saveToolToWorkspace: (proposed: Partial<ToolItem>) => Promise<ToolItem>;

  // Chat conversations
  conversations: ChatConversation[];
  activeConversationId: string | null;
  activeConversation: ChatConversation | null;
  startNewChat: (botId?: string) => void;
  /** Switch to the chat section while keeping the open conversation on screen. */
  goToChat: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, newTitle: string) => void;
  sendMessage: (content: string, attachments?: { name: string; sizeFormatted: string; type: string }[]) => void;
  /**
   * Text to put in the composer from elsewhere in the UI.
   *
   * Set when the user edits an earlier request. The conversation is append-only, so the correction
   * is re-asked rather than rewritten, and the seed is cleared once applied so it cannot reappear.
   */
  composerSeed: string | null;
  setComposerSeed: (text: string) => void;
  clearComposerSeed: () => void;
  isStreaming: boolean;
  stopStreaming: () => void;
  regenerateLastMessage: () => void;
  /** Re-runs the last turn after a failure, from the Retry affordance in the transcript. */
  retryLastMessage: () => void;
  setMessageFeedback: (messageId: string, feedback: 'good' | 'bad') => void;
  /**
   * What the agent is doing, per assistant message.
   *
   * Keyed by message so a progress list belongs to the turn that produced it: switching chats or
   * collapsing the preview cannot leave a stale "working" indicator behind on an older answer.
   */
  buildProgress: Record<string, ProgressStep[]>;

  // The artifact: the bot the open conversation produced, and the preview workspace around it.
  // One chat builds one bot, so this is derived from the conversation's own binding rather than
  // stored separately — `New Chat` is the only way to start a different one.
  artifact: BotItem | null;
  artifactStatus: ArtifactStatus;
  isPreviewOpen: boolean;
  setIsPreviewOpen: (open: boolean) => void;
  openPreview: () => void;
  closePreview: () => void;
  /** Saves an edit from the compact config. Only the keys the editor touched are sent. */
  saveArtifact: (changes: Partial<BotItem>) => Promise<void>;
  publishArtifact: () => void;
  /** True while the AI is turning a prompt into a bot proposal. */
  isBuilding: boolean;

  // The preview's live chat with the artifact. Talking *to* the bot is not a change request
  // for it, so it is deliberately not part of the builder conversation.
  previewMessages: ChatMessage[];
  sendPreviewMessage: (content: string) => void;
  isPreviewStreaming: boolean;
  clearPreviewMessages: () => void;

  // Bots & Studio Workspace
  bots: BotItem[];
  selectedBotId: string;
  setSelectedBotId: (id: string) => void;
  selectedBot: BotItem;
  editingBot: BotItem | null;
  setEditingBot: (bot: BotItem | null) => void;
  createSimpleBot: (promptText?: string) => Promise<BotItem>;
  createSimpleBotFromChat: (prompt: string) => Promise<BotItem>;
  pendingBotOffer: PendingBotOffer | null;
  dismissBotOffer: () => void;
  selectBot: (botId: string) => void;
  saveBot: (bot: BotItem) => void;
  toggleBotEnabled: (botId: string) => void;
  testBotMessage: (message: string) => void;
  botSimulationMessages: ChatMessage[];
  clearBotSimulation: () => void;
  resetBotSimulation: (bot: BotItem) => void;
  agentRefineBot: (botId: string, prompt: string) => void;
  agentEditMessages: ChatMessage[];
  clearAgentEditChat: () => void;
  isAgentEditing: boolean;

  // Tools
  tools: ToolItem[];
  toggleTool: (toolId: string) => void;
  addTool: (tool: Partial<ToolItem>) => void;

  // Knowledge
  knowledge: KnowledgeItem[];
  uploadFiles: (files: File[]) => void;

  // Account
  account: WorkspaceAccount;
  resetWorkspaceData: () => void;

  // Command Palette
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: (open: boolean) => void;
}

const EMPTY_ACCOUNT: WorkspaceAccount = {
  id: '',
  name: '',
  plan: '',
  runsUsed: 0,
  runsLimit: 0,
  tokensUsedMillion: 0,
  tokensLimitMillion: 0,
};

const FALLBACK_BOT: BotItem = {
  id: '',
  name: 'Assistant',
  description: '',
  avatarIcon: 'Bot',
  avatarBg: 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]',
  model: '',
  instructions: '',
  toolIds: [],
  knowledgeIds: [],
  variables: [],
  temperature: 0.2,
  status: 'draft',
  enabled: false,
  version: '0.0.0',
  versions: [],
  metrics: { totalRuns: 0, avgLatencyMs: 0, tokensConsumed: 0, successRatePercent: 0 },
  lastUsed: 'Never',
};

const EMPTY_BOTS: BotItem[] = [];
const EMPTY_TOOLS: ToolItem[] = [];
const EMPTY_KNOWLEDGE: KnowledgeItem[] = [];
const EMPTY_CONVERSATIONS: ChatConversation[] = [];

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

function botToWrite(bot: BotItem): BotWrite {
  return {
    name: bot.name,
    name_fa: bot.nameFa,
    description: bot.description,
    description_fa: bot.descriptionFa,
    avatar_icon: bot.avatarIcon,
    avatar_bg: bot.avatarBg,
    bot_type: bot.botType ?? 'agent',
    provider: bot.provider,
    model_id: bot.modelId,
    instructions: bot.instructions,
    instructions_fa: bot.instructionsFa,
    tool_ids: bot.toolIds,
    knowledge_ids: bot.knowledgeIds,
    deterministic_rules: bot.deterministicRules ?? [],
    variables: bot.variables,
    temperature: bot.temperature,
    top_p: bot.topP,
    max_output_tokens: bot.maxOutputTokens,
    status: bot.status,
    enabled: bot.enabled,
  };
}

function toolToWrite(tool: Partial<ToolItem>): ToolWrite {
  const config = (tool.config ?? {}) as Record<string, unknown>;
  return {
    name: tool.name || 'Custom Tool',
    name_fa: tool.nameFa,
    purpose: tool.purpose || 'Custom external capability',
    purpose_fa: tool.purposeFa,
    icon: tool.icon || 'Link',
    connection_state: tool.connectionState || 'Connected',
    category: tool.category || 'api',
    enabled: tool.enabled ?? true,
    config,
    input_schema: (config.inputSchema as Record<string, unknown>) ?? {
      type: 'object',
      properties: {},
    },
    output_schema: (config.outputSchema as Record<string, unknown>) ?? { type: 'object' },
    handler: (config.handler as 'builtin' | 'http' | 'docker') ?? 'builtin',
    handler_config: (config.handlerConfig as Record<string, unknown>) ?? {},
    timeout_seconds: (config.timeoutSeconds as number) ?? 20,
    permissions: (config.permissions as string[]) ?? [],
  };
}

/**
 * Projects an AI proposal onto the fields a builder turn owns, and widens the ones the compact
 * config owns.
 *
 * `tool_ids`, `knowledge_ids` and `variables` are the user's direct-manipulation surface. A
 * conversation about response tone should not silently detach a source someone wired up by hand, so
 * a proposal unions into them instead of replacing them. Name, instructions and the model are
 * rewritten wholesale: the AI is re-authoring the bot, not patching it.
 */
function proposalPatch(current: BotItem | null, proposal: Partial<BotItem>): BotWrite {
  const patch: BotWrite = {
    name: proposal.name ?? current?.name ?? 'Untitled bot',
    description: proposal.description ?? current?.description ?? '',
    instructions: proposal.instructions ?? current?.instructions ?? '',
    temperature: proposal.temperature ?? current?.temperature,
    tool_ids: union(current?.toolIds, proposal.toolIds),
    knowledge_ids: union(current?.knowledgeIds, proposal.knowledgeIds),
    variables: unionVariables(current?.variables, proposal.variables),
  };
  if (proposal.botType) patch.bot_type = proposal.botType;
  // Model identity belongs to provider + model id; the `model` label is derived server-side.
  if (proposal.provider) patch.provider = proposal.provider;
  if (proposal.modelId) patch.model_id = proposal.modelId;
  if (proposal.deterministicRules) patch.deterministic_rules = proposal.deterministicRules;
  return patch;
}

function union(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  return [...new Set([...(existing ?? []), ...(incoming ?? [])])];
}

/** Union keyed by variable name, so a re-proposed value updates but a manual addition survives. */
function unionVariables(
  existing: BotVariable[] | undefined,
  incoming: BotVariable[] | undefined
): BotVariable[] {
  const merged = new Map<string, BotVariable>();
  for (const variable of existing ?? []) merged.set(variable.name, variable);
  for (const variable of incoming ?? []) merged.set(variable.name, variable);
  return [...merged.values()];
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() =>
    readStorage(STORAGE_KEYS.sidebarCollapsed, false)
  );
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Auth (server-owned session; only the tokens are persisted locally)
  const sessionQuery = useQuery<SessionData | null>({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
  });
  const session = sessionQuery.data?.user ?? null;
  const account = sessionQuery.data?.workspace ?? EMPTY_ACCOUNT;
  const isAuthenticated = session !== null;

  const profile = useMemo(() => {
    const name = session?.name?.trim() || session?.email?.split('@')[0] || '';
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
    return {
      name,
      email: session?.email ?? '',
      firstName: name.split(' ')[0] || name,
      initials: initials || '?',
    };
  }, [session]);

  // i18n
  const [locale, setLocaleState] = useState<SupportedLocale>(() =>
    readStorage(STORAGE_KEYS.locale, 'en')
  );
  const t = translations[locale];
  const isRTL = locale === 'fa';

  // Dynamic Theme
  const [themePresetId, setThemePresetId] = useState<string>(() =>
    readStorage(STORAGE_KEYS.themePresetId, 'custom')
  );
  const [customPrimaryColor, setCustomPrimaryColor] = useState<string>(() =>
    readStorage(STORAGE_KEYS.customPrimaryColor, '#0f766e')
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readStorage(STORAGE_KEYS.themeMode, 'dark')
  );

  // Chat Mode
  const [chatMode, setChatMode] = useState<ChatMode>('chat');
  const [agentMode, setAgentMode] = useState<AgentMode>('agent-bot');
  const [editingBotInChat, setEditingBotInChat] = useState<BotItem | null>(null);

  // Studio Workspace
  const [isAgentEditing, setIsAgentEditing] = useState(false);

  // Domain state (server-owned). Every collection is a query, so a route loader
  // that already primed the cache hands this component its data for free.
  const botsQuery = useQuery({
    queryKey: queryKeys.bots,
    queryFn: fetchBots,
    enabled: isAuthenticated,
  });
  const toolsQuery = useQuery({
    queryKey: queryKeys.tools,
    queryFn: fetchTools,
    enabled: isAuthenticated,
  });
  const knowledgeQuery = useQuery({
    queryKey: queryKeys.knowledge,
    queryFn: fetchKnowledge,
    enabled: isAuthenticated,
    // Indexing progress only exists server-side, so poll until nothing is pending.
    refetchInterval: (query) => (hasPendingKnowledge(query.state.data) ? 1_500 : false),
  });
  const conversationsQuery = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: fetchConversations,
    enabled: isAuthenticated,
  });

  const bots = botsQuery.data ?? EMPTY_BOTS;
  const tools = toolsQuery.data ?? EMPTY_TOOLS;
  const knowledge = knowledgeQuery.data ?? EMPTY_KNOWLEDGE;
  const conversations = conversationsQuery.data ?? EMPTY_CONVERSATIONS;

  const [selectedBotId, setSelectedBotId] = useState<string>(() =>
    readStorage(STORAGE_KEYS.selectedBotId, '')
  );
  const [editingBot, setEditingBot] = useState<BotItem | null>(null);
  const [pendingBotOffer, setPendingBotOffer] = useState<PendingBotOffer | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  // The activity list for the turn in flight. Filled from run events only.
  const [buildProgress, setBuildProgress] = useState<Record<string, ProgressStep[]>>({});
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [composerSeed, setComposerSeedState] = useState<string | null>(null);

  // The artifact preview. Collapsing it never discards the bot: the binding lives on the
  // conversation, so the artifact comes back exactly as it was.
  const [builderHostId, setBuilderHostId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [artifactStatus, setArtifactStatus] = useState<ArtifactStatus>('draft');
  const [previewMessages, setPreviewMessages] = useState<ChatMessage[]>([]);
  const [isPreviewStreaming, setIsPreviewStreaming] = useState(false);

  const [botSimulationMessages, setBotSimulationMessages] = useState<ChatMessage[]>([]);
  const [agentEditMessages, setAgentEditMessages] = useState<ChatMessage[]>([
    {
      id: 'agent-edit-init',
      sender: 'bot',
      content:
        'I am your Bot Architecture Agent. Tell me how you would like to refine this bot (e.g. adjust tone, inject safety rules, connect new tools, or lower temperature).',
      timestamp: 'Ready',
    },
  ]);

  // Latest-value refs so async callbacks never read stale state.
  const selectedBotIdRef = useRef(selectedBotId);
  const activeConversationIdRef = useRef(activeConversationId);
  const agentModeRef = useRef(agentMode);
  const editingBotRef = useRef(editingBot);
    selectedBotIdRef.current = selectedBotId;
  activeConversationIdRef.current = activeConversationId;
  agentModeRef.current = agentMode;
  editingBotRef.current = editingBot;

  const activeRunRef = useRef<{ runId: string; conversationId: string; assistantId: string; stream: RunStream } | null>(null);
  const simulationStreamRef = useRef<RunStream | null>(null);
  const previewRunRef = useRef<RunStream | null>(null);
  const previewRunIdRef = useRef<string | null>(null);
  const botsRef = useRef<BotItem[]>([]);
  botsRef.current = bots;

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotId) || bots[0] || FALLBACK_BOT,
    [bots, selectedBotId]
  );

  const activeConversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [conversations, activeConversationId]);

  const artifact = useMemo(() => {
    // A conversation still pointed at the builder host has not produced a bot yet.
    if (!activeConversation || !builderHostId) return null;
    if (activeConversation.botId === builderHostId) return null;
    return bots.find((b) => b.id === activeConversation.botId) ?? null;
  }, [activeConversation, bots, builderHostId]);

  /**
   * Cache write helpers. Streaming messages arrive outside any fetch, so they are
   * written straight into the query cache rather than mirrored in local state.
   */
  const updateConversations = useCallback(
    (updater: (prev: ChatConversation[]) => ChatConversation[]) => {
      queryClient.setQueryData<ChatConversation[]>(queryKeys.conversations, (prev) =>
        updater(prev ?? []),
      );
    },
    []
  );

  const patchMessage = useCallback(
    (conversationId: string, messageId: string, patch: (m: ChatMessage) => ChatMessage) => {
      updateConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? patch(m) : m)) }
            : c
        )
      );
    },
    [updateConversations]
  );

  // --- cache-backed writes -------------------------------------------------

  /** Refreshes every collection the workspace owns. */
  const reloadWorkspace = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.bots }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tools }),
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
    ]);
  }, []);

  /** Keeps the selected bot valid once the bots query resolves. */
  useEffect(() => {
    if (bots.length === 0) return;
    setSelectedBotId((prev) => (bots.some((b) => b.id === prev) ? prev : bots[0]?.id ?? ''));
  }, [bots]);

  const setBotsInCache = useCallback(
    (updater: (prev: BotItem[]) => BotItem[]) => {
      queryClient.setQueryData<BotItem[]>(queryKeys.bots, (prev) => updater(prev ?? []));
    },
    []
  );

  const upsertBot = useCallback(
    (bot: BotItem) => {
      setBotsInCache((prev) => [bot, ...prev.filter((b) => b.id !== bot.id)]);
      queryClient.setQueryData(queryKeys.bot(bot.id), bot);
    },
    [setBotsInCache]
  );

  const replaceBot = useCallback(
    (bot: BotItem) => {
      setBotsInCache((prev) => prev.map((b) => (b.id === bot.id ? bot : b)));
      queryClient.setQueryData(queryKeys.bot(bot.id), bot);
      setEditingBot((prev) => (prev && prev.id === bot.id ? bot : prev));
    },
    [setBotsInCache]
  );

  // --- mutations ----------------------------------------------------------

  const signInMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login({ email: email.trim(), password }),
  });
  const signUpMutation = useMutation({
    mutationFn: ({ email, name, password }: { email: string; name: string; password: string }) =>
      authApi.register({ email: email.trim(), name: name.trim(), password }),
  });
  const signOutMutation = useMutation({ mutationFn: () => authApi.logout() });

  const createBotMutation = useMutation({
    mutationFn: (body: BotWrite) => botsApi.create(body),
    onSuccess: (bot) => upsertBot(bot),
  });

  const updateBotMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: BotWrite }) => botsApi.update(id, body),
    onSuccess: (saved) => replaceBot(saved),
  });

  const deleteBotMutation = useMutation({
    mutationFn: (id: string) => botsApi.remove(id),
    onSuccess: (_data, id) => {
      setBotsInCache((prev) => prev.filter((b) => b.id !== id));
      queryClient.removeQueries({ queryKey: queryKeys.bot(id) });
    },
  });

  const createToolMutation = useMutation({
    mutationFn: (body: ToolWrite) => toolsApi.create(body),
    onSuccess: (tool) => {
      queryClient.setQueryData<ToolItem[]>(queryKeys.tools, (prev) => [
        tool,
        ...(prev ?? []).filter((t) => t.id !== tool.id),
      ]);
    },
  });

  const updateToolMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ToolWrite> }) => toolsApi.update(id, body),
    onSuccess: (saved) => {
      queryClient.setQueryData<ToolItem[]>(queryKeys.tools, (prev) =>
        (prev ?? []).map((t) => (t.id === saved.id ? saved : t)),
      );
    },
  });

  const uploadKnowledgeMutation = useMutation({
    mutationFn: (files: File[]) => knowledgeApi.upload(files),
    onSuccess: (created) => {
      queryClient.setQueryData<KnowledgeItem[]>(queryKeys.knowledge, (prev) => [
        ...created,
        ...(prev ?? []),
      ]);
    },
  });

  const renameConversationMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      conversationsApi.update(id, { title }),
    onSuccess: (saved) => {
      updateConversations((prev) => prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)));
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: (id: string) => conversationsApi.remove(id),
    onSuccess: (_data, id) => {
      updateConversations((prev) => prev.filter((c) => c.id !== id));
      queryClient.removeQueries({ queryKey: queryKeys.conversation(id) });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({
      conversationId,
      content,
      attachments,
    }: {
      conversationId: string;
      content: string;
      attachments?: { name: string; sizeFormatted: string; type: string }[];
    }) =>
      conversationsApi.sendMessage(conversationId, {
        content,
        attachments: attachments?.map((a) => ({
          name: a.name,
          size_formatted: a.sizeFormatted,
          type: a.type,
        })),
      }),
  });

  const feedbackMutation = useMutation({
    mutationFn: ({ messageId, feedback }: { messageId: string; feedback: 'good' | 'bad' }) =>
      conversationsApi.feedback(messageId, feedback),
  });

  // Clean up any live streams on unmount.
  useEffect(
    () => () => {
      activeRunRef.current?.stream.close();
      simulationStreamRef.current?.close();
      previewRunRef.current?.close();
    },
    []
  );

  // --- auth ---------------------------------------------------------------

  /** Signs in and primes the cache, so the first authenticated route resolves warm. */
  const completeAuth = useCallback(
    async (result: { user: { name: string; email: string }; workspace: WorkspaceAccount }) => {
      setSessionCache({
        user: { name: result.user.name, email: result.user.email },
        workspace: result.workspace,
      });
    },
    []
  );

  const signIn = async (email: string, password: string) => {
    const result = await signInMutation.mutateAsync({ email, password });
    await completeAuth(result);
    await navigate({ to: '/chat', replace: true });
  };

  const signUp = async (email: string, name: string, password: string) => {
    const result = await signUpMutation.mutateAsync({ email, name, password });
    await completeAuth(result);
    await navigate({ to: '/chat', replace: true });
  };

  const signOut = () => {
    void signOutMutation.mutateAsync().catch(() => undefined);
    resetQueryCache();
    setActiveConversationId(null);
    setEditingBot(null);
    setBotSimulationMessages([]);
    setPreviewMessages([]);
    setIsPreviewOpen(false);
    void navigate({ to: '/login', replace: true });
  };

  // Persist presentation settings only.
  useEffect(() => writeStorage(STORAGE_KEYS.themeMode, themeMode), [themeMode]);
  useEffect(() => writeStorage(STORAGE_KEYS.themePresetId, themePresetId), [themePresetId]);
  useEffect(() => writeStorage(STORAGE_KEYS.customPrimaryColor, customPrimaryColor), [customPrimaryColor]);
  useEffect(() => writeStorage(STORAGE_KEYS.locale, locale), [locale]);
  useEffect(() => writeStorage(STORAGE_KEYS.sidebarCollapsed, isSidebarCollapsed), [isSidebarCollapsed]);
  useEffect(() => writeStorage(STORAGE_KEYS.selectedBotId, selectedBotId), [selectedBotId]);

  // Apply M3 Theme Tokens
  useEffect(() => {
    const isDark =
      themeMode === 'dark' ||
      (themeMode === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyThemeTokensToDocument(generateMaterial3ThemeTokens(customPrimaryColor, isDark), isDark);
  }, [themePresetId, customPrimaryColor, themeMode]);

  // Keyboard shortcut Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- conversations & runs ----------------------------------------------

  /**
   * Opens the chat section on a blank conversation.
   *
   * Starting a *different* bot is this action, deliberately: the open conversation is never reused
   * for a second bot, and the preview closes so the previous artifact cannot be mistaken for the
   * next one.
   */
  const startNewChat = (botId?: string) => {
    setActiveConversationId(null);
    setChatMode('chat');
    setEditingBotInChat(null);
    setIsPreviewOpen(false);
    setArtifactStatus('draft');
    setPreviewMessages([]);
    if (botId) setSelectedBotId(botId);
    setIsMobileDrawerOpen(false);
  };

  /** Switches to the chat section while keeping the open conversation on screen. */
  const goToChat = () => setIsMobileDrawerOpen(false);

  /** Re-asks an earlier request by reopening it in the composer. */
  const setComposerSeed = (text: string) => setComposerSeedState(text);
  const clearComposerSeed = () => setComposerSeedState(null);

  const openPreview = () => setIsPreviewOpen(true);
  const closePreview = () => setIsPreviewOpen(false);

  /**
   * The workspace's builder host, fetched once and remembered.
   *
   * A builder conversation is created before the bot it builds exists, but every run needs a bot to
   * execute against, so the backend provisions one on demand. It is never surfaced as an artifact.
   */
  const builderHost = useCallback(async (): Promise<string> => {
    if (builderHostId) return builderHostId;
    const host = await botsApi.builder();
    setBuilderHostId(host.id);
    queryClient.setQueryData(queryKeys.bot(host.id), host);
    return host.id;
  }, [builderHostId, queryClient]);

  const startBotGenerationChat = () => {
    setActiveConversationId(null);
    setChatMode('bot-generation');
    setEditingBotInChat(null);
    setIsMobileDrawerOpen(false);
  };

  const selectConversation = (id: string) => {
    setActiveConversationId(id);
    setIsMobileDrawerOpen(false);
    void (async () => {
      try {
        // Cached per conversation, so reopening a chat is instant and a repeat
        // visit never re-requests it.
        const full = await queryClient.ensureQueryData({
          queryKey: queryKeys.conversation(id),
          queryFn: () => conversationsApi.get(id),
          staleTime: Infinity,
        });
        updateConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, ...full, messages: full.messages } : c))
        );
        setSelectedBotId(full.botId);
        // The preview is the artifact's own surface, so a different chat starts without it.
        setIsPreviewOpen(false);
        setArtifactStatus('draft');
        setPreviewMessages([]);
        if (full.mode === 'simple-bot') {
          setAgentMode('simple-bot');
          setChatMode('bot-generation');
        } else {
          setAgentMode('agent-bot');
          setChatMode('chat');
        }
      } catch {
        // A conversation that vanished server-side simply is not selected.
      }
    })();
  };

  const deleteConversation = (id: string) => {
    // Optimistic: the row disappears immediately and is restored by the mutation's
    // error handling below.
    updateConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) setActiveConversationId(null);
    deleteConversationMutation.mutate(id, {
      onError: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      },
    });
  };

  const renameConversation = (id: string, newTitle: string) => {
    updateConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c)));
    renameConversationMutation.mutate({ id, title: newTitle }, {
      onError: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      },
    });
  };

  /**
   * Binds the artifact to its chat.
   *
   * The conversation was created against the builder host because the bot did not exist yet. This
   * re-points it, which is what makes the *next* builder turn refine the real bot — the proposal
   * generator reads the bound bot's instructions — rather than re-plan from nothing.
   */
  const bindArtifact = useCallback(
    async (conversationId: string, botId: string) => {
      await conversationsApi.update(conversationId, { bot_id: botId });
      updateConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, botId } : c)));
      setSelectedBotId(botId);
    },
    [updateConversations]
  );

  /** Creates the artifact on the first proposal, or updates it in place on every one after. */
  const applyProposal = useCallback(
    async (proposal: Partial<BotItem>) => {
      const conversationId = activeConversationIdRef.current;
      if (!conversationId) return;
      const current = artifact;
      if (!current) {
        const created = await createBotMutation.mutateAsync(proposalPatch(null, proposal));
        await bindArtifact(conversationId, created.id);
      } else {
        await updateBotMutation.mutateAsync({ id: current.id, body: proposalPatch(current, proposal) });
      }
      // The preview is a conversation with the artifact; a rebuilt bot invalidates it.
      setPreviewMessages([]);
      setArtifactStatus('draft');
    },
    [artifact, bindArtifact, createBotMutation, updateBotMutation]
  );

  /**
   * Saves an edit from the compact config.
   *
   * A PATCH changes what it mentions and nothing else, so only the keys the editor actually touched
   * are sent. Resending a full write would append a new immutable version per keystroke.
   */
  const saveArtifact = useCallback(
    async (changes: Partial<BotItem>) => {
      if (!artifact) return;
      const body: BotWrite = {};
      if (changes.name !== undefined) body.name = changes.name;
      if (changes.description !== undefined) body.description = changes.description;
      if (changes.instructions !== undefined) body.instructions = changes.instructions;
      if (changes.provider !== undefined) body.provider = changes.provider;
      if (changes.modelId !== undefined) body.model_id = changes.modelId;
      if (changes.temperature !== undefined) body.temperature = changes.temperature;
      if (changes.toolIds !== undefined) body.tool_ids = changes.toolIds;
      if (changes.knowledgeIds !== undefined) body.knowledge_ids = changes.knowledgeIds;
      if (changes.variables !== undefined) body.variables = changes.variables;
      if (Object.keys(body).length === 0) return;
      await updateBotMutation.mutateAsync({ id: artifact.id, body });
    },
    [artifact, updateBotMutation]
  );

  const publishArtifact = useCallback(() => {
    if (!artifact) return;
    updateBotMutation.mutate(
      { id: artifact.id, body: { enabled: true, status: 'active' } },
      { onSuccess: () => setArtifactStatus('published') }
    );
  }, [artifact, updateBotMutation]);

  const finalizeRun = useCallback(async (conversationId: string, assistantId: string) => {
    const current = activeRunRef.current;
    if (current && current.assistantId === assistantId) {
      activeRunRef.current = null;
      current.stream.close();
    }
    setIsStreaming(false);
    // Close whatever stage was open: the run is over, so nothing may keep reading as "working".
    setBuildProgress((prev) =>
      prev[assistantId]
        ? { ...prev, [assistantId]: finishProgress(prev[assistantId]) }
        : prev
    );
    try {
      // Read straight from the API rather than through the cache: the point of this refresh is to
      // pick up the run's durable output, and a long staleTime would answer from the previous turn.
      const fresh = await conversationsApi.get(conversationId);
      queryClient.setQueryData(queryKeys.conversation(conversationId), fresh);
      updateConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, ...fresh, messages: fresh.messages } : c))
      );

      // A builder turn ends in a proposal rather than prose. Applying it here — after the
      // transcript has settled — is what turns a conversation into an artifact.
      const answered = fresh.messages.find((m) => m.id === assistantId);
      const proposal = answered?.botProposal?.proposedBot;
      if (proposal && Object.keys(proposal).length > 0) {
        setIsBuilding(true);
        try {
          await applyProposal(proposal);
        } catch (error) {
          patchMessage(conversationId, assistantId, (m) => ({
            ...m,
            content: `${m.content}\n\n_I could not apply that change: ${errorMessage(error)}_`,
          }));
        } finally {
          setIsBuilding(false);
        }
      }
    } catch {
      // Keep whatever was streamed if the refresh fails.
      patchMessage(conversationId, assistantId, (m) => ({ ...m, isStreaming: false }));
    }
  }, [applyProposal, patchMessage, queryClient, updateConversations]);

  const startRunStream = useCallback(
    (conversationId: string, runId: string, assistantId: string) => {
      activeRunRef.current?.stream.close();
      const stream = subscribeToRun(runId, {
        onEvent: (event: RunEvent) => {
          const eventType = event.data?.type as string | undefined;
          // Activity first: it is the same event the answer depends on, so the two can never
          // disagree about what the agent is doing.
          setBuildProgress((prev) =>
            event.type === 'agent.delta'
              ? prev
              : {
                  ...prev,
                  [assistantId]: reduceProgress(prev[assistantId] ?? [], event, t),
                }
          );
          if (event.type === 'agent.delta') {
            const text = String(event.data?.text ?? '');
            if (text) {
              patchMessage(conversationId, assistantId, (m) => ({
                ...m,
                content: m.content + text,
                isStreaming: true,
              }));
            }
            return;
          }
          if (event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.failed') {
            const name = String(event.data?.tool ?? 'tool');
            const status =
              event.type === 'tool.started' ? 'running' : event.type === 'tool.completed' ? 'completed' : 'failed';
            patchMessage(conversationId, assistantId, (m) => {
              const activity = [...(m.toolActivity ?? [])];
              const index = activity.findIndex((a) => a.name === name);
              const entry = { name, status: status as 'running' | 'completed' | 'failed', detail: String(event.data?.detail ?? '') };
              if (index === -1) activity.push(entry);
              else activity[index] = entry;
              return { ...m, toolActivity: activity };
            });
            return;
          }
          if (event.type === 'run.failed') {
            const message = String(event.data?.message ?? eventType ?? 'The run failed.');
            patchMessage(conversationId, assistantId, (m) => ({
              ...m,
              content: m.content || message,
              isStreaming: false,
            }));
            return;
          }
          if (event.type === 'run.cancelled') {
            patchMessage(conversationId, assistantId, (m) => ({ ...m, isStreaming: false }));
          }
        },
        onError: () => void finalizeRun(conversationId, assistantId),
        onClose: () => {
          if (activeRunRef.current?.assistantId === assistantId) {
            void finalizeRun(conversationId, assistantId);
          }
        },
      });
      activeRunRef.current = { runId, conversationId, assistantId, stream };
    },
    [finalizeRun, patchMessage]
  );

  const sendMessage = (
    content: string,
    attachments?: { name: string; sizeFormatted: string; type: string }[]
  ) => {
    const text = content?.trim() ?? '';
    if (!text && (!attachments || attachments.length === 0)) return;
    setIsStreaming(true);
    void (async () => {
      try {
        if (!activeConversationIdRef.current) {
          // A builder chat runs against the workspace's builder host until the AI produces the
          // artifact; every other mode keeps talking to the bot the user selected.
          const isBuilder = agentModeRef.current === 'agent-bot';
          const botId = isBuilder ? await builderHost() : selectedBotIdRef.current;
          const created = await conversationsApi.create({
            bot_id: botId,
            title: text.slice(0, 36) || 'New Conversation',
            // `bot-building` is what makes the turn produce a bot proposal instead of prose.
            mode: isBuilder ? 'bot-building' : agentModeRef.current,
          });
          updateConversations((prev) => [
            { ...created, messages: [] },
            ...prev.filter((c) => c.id !== created.id),
          ]);
          setActiveConversationId(created.id);
          activeConversationIdRef.current = created.id;
        }
        const conversationId = activeConversationIdRef.current as string;
        const result = await sendMessageMutation.mutateAsync({
          conversationId,
          content: text,
          attachments,
        });
        updateConversations((prev) =>
          prev.map((c) => {
            if (c.id !== conversationId) return c;
            const without = c.messages.filter(
              (m) => m.id !== result.user_message.id && m.id !== result.assistant_message.id
            );
            return {
              ...c,
              updatedAt: 'Just now',
              messages: [...without, result.user_message, result.assistant_message],
            };
          })
        );
        startRunStream(conversationId, result.run_id, result.assistant_message.id);
      } catch (error) {
        setIsStreaming(false);
        const conversationId = activeConversationIdRef.current;
        if (conversationId) {
          const failure: ChatMessage = {
            id: `error-${Date.now()}`,
            sender: 'bot',
            content: errorMessage(error),
            timestamp: 'Just now',
          };
          updateConversations((prev) =>
            prev.map((c) => (c.id === conversationId ? { ...c, messages: [...c.messages, failure] } : c))
          );
        }
      }
    })();
  };

  const stopStreaming = () => {
    const current = activeRunRef.current;
    activeRunRef.current = null;
    setIsStreaming(false);
    if (current) {
      current.stream.close();
      void runsApi.cancel(current.runId).catch(() => undefined);
      patchMessage(current.conversationId, current.assistantId, (m) => ({ ...m, isStreaming: false }));
    }
  };

  const regenerateLastMessage = () => {
    if (!activeConversation || activeConversation.messages.length === 0) return;
    const lastUserMsg = [...activeConversation.messages].reverse().find((m) => m.sender === 'user');
    if (lastUserMsg) sendMessage(lastUserMsg.content);
  };

  /**
   * Retrying after a failure.
   *
   * The failure notice is removed before the request goes out again. Retrying *appends* to a
   * transcript whose last line is the error, so the user would watch the same problem twice and
   * the new answer would answer the error rather than their original request.
   */
  const retryLastMessage = () => {
    const conversationId = activeConversationIdRef.current;
    if (conversationId) {
      updateConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages: c.messages.filter((m) => !m.id.startsWith('error-')) }
            : c
        )
      );
    }
    regenerateLastMessage();
  };

  const setMessageFeedback = (messageId: string, feedback: 'good' | 'bad') => {
    updateConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === messageId ? { ...m, feedback } : m)),
      }))
    );
    feedbackMutation.mutate({ messageId, feedback });
  };

  // --- the preview's live chat --------------------------------------------

  const clearPreviewMessages = () => {
    previewRunRef.current?.close();
    previewRunRef.current = null;
    previewRunIdRef.current = null;
    setPreviewMessages([]);
    setIsPreviewStreaming(false);
  };

  /**
   * One turn of live conversation with the artifact.
   *
   * This runs the bot, not the designer, which is why it is not part of the builder conversation:
   * "where is my order?" is a question for the bot, not a change request for it.
   */
  const sendPreviewMessage = (content: string) => {
    const text = content?.trim() ?? '';
    if (!text || !artifact) return;
    const assistantId = `preview-${Date.now()}`;
    setIsPreviewStreaming(true);
    setArtifactStatus((prev) => (prev === 'published' ? prev : 'ready'));
    setPreviewMessages((prev) => [
      ...prev,
      { id: `preview-user-${Date.now()}`, sender: 'user', content: text, timestamp: 'Just now' },
      { id: assistantId, sender: 'bot', content: '', timestamp: 'Streaming', isStreaming: true },
    ]);

    const botId = artifact.id;
    previewRunRef.current?.close();
    void (async () => {
      /** Deterministic bots emit no deltas, so the durable run record is the only final output. */
      const settle = async () => {
        try {
          const record = await runsApi.get(previewRunIdRef.current as string);
          setPreviewMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: m.content || record.output || '',
                    isStreaming: false,
                    timestamp: m.timestamp === 'Streaming' ? 'Just now' : m.timestamp,
                  }
                : m
            )
          );
        } catch {
          setPreviewMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
          );
        } finally {
          setIsPreviewStreaming(false);
        }
      };
      try {
        const run = await runsApi.create({ bot_id: botId, input: text });
        previewRunIdRef.current = run.run_id;
        const stream = subscribeToRun(run.run_id, {
          onEvent: (event: RunEvent) => {
            if (event.type === 'agent.delta') {
              const chunk = String(event.data?.text ?? '');
              if (chunk) {
                setPreviewMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
                );
              }
            } else if (event.type === 'run.failed') {
              const failure = String(event.data?.message ?? 'The run failed.');
              setPreviewMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content || failure, isStreaming: false } : m
                )
              );
            } else if (event.type === 'run.completed') {
              void settle();
            }
          },
          onError: () => void settle(),
          onClose: () => void settle(),
        });
        previewRunRef.current = stream;
      } catch (error) {
        setPreviewMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: errorMessage(error), isStreaming: false } : m
          )
        );
        setIsPreviewStreaming(false);
      }
    })();
  };

  // --- bot studio ---------------------------------------------------------

  const resetBotSimulation = useCallback(
    (bot: BotItem) => {
      const name = isRTL ? bot.nameFa || bot.name : bot.name;
      setBotSimulationMessages([
        {
          id: `sim-intro-${bot.id}`,
          sender: 'bot',
          content: `Hi, I'm ${name}. Send a message to test this bot.`,
          timestamp: 'Ready',
        },
      ]);
    },
    [isRTL]
  );

  /**
   * Marks a bot as the one being worked on. Navigation itself belongs to the
   * router, so callers pair this with their own `navigate(...)` call.
   */
  const selectBot = (botId: string) => {
    setSelectedBotId(botId);
    setEditingBot(bots.find((b) => b.id === botId) ?? null);
  };

  const createSimpleBot = async (promptText?: string): Promise<BotItem> => {
    const cleanPrompt = promptText?.trim() || '';
    const firstWord = cleanPrompt.split(' ')[0]?.toLowerCase() || 'ping';
    const botName =
      cleanPrompt.length > 0
        ? cleanPrompt.length > 24
          ? `${cleanPrompt.slice(0, 24).trim()}...`
          : cleanPrompt
        : `Static Rule Bot #${bots.length + 1}`;
    const rules = [
      { trigger: firstWord, response: `Instant deterministic match for "${cleanPrompt || firstWord}".` },
      { trigger: 'ping', response: 'pong! (Instant deterministic execution)' },
      { trigger: 'help', response: 'Available commands: ping, status, help, pricing' },
      { trigger: 'status', response: 'All systems operational. Zero model dependencies.' },
    ];
    const created = await createBotMutation.mutateAsync({
      name: botName,
      name_fa: botName,
      description: cleanPrompt || 'Deterministic rule-based bot operating without any LLM models.',
      description_fa: cleanPrompt || 'بات قطعی مبتنی بر قانون بدون نیاز به مدل‌های زبانی.',
      avatar_icon: '⚡',
      bot_type: 'simple',
      deterministic_rules: rules,
      instructions: 'Deterministic condition-action rules without models, tools, or knowledge.',
    });
    setSelectedBotId(created.id);
    return created;
  };

  /**
   * New-chat → bot creation. The bot is created, the prompt is sent to it as a
   * real conversation and the user simply stays in the chat; jumping to the
   * Studio is an explicit, optional follow-up.
   */
  const createSimpleBotFromChat = async (prompt: string): Promise<BotItem> => {
    const created = await createSimpleBot(prompt);
    const conversation = await conversationsApi.create({
      bot_id: created.id,
      title: prompt.slice(0, 36) || 'New Conversation',
      mode: 'simple-bot',
    });
    updateConversations((prev) => [
      { ...conversation, messages: [] },
      ...prev.filter((c) => c.id !== conversation.id),
    ]);
    setActiveConversationId(conversation.id);
    activeConversationIdRef.current = conversation.id;
    setPendingBotOffer({ botId: created.id, nonce: Date.now() });
    sendMessage(prompt);
    return created;
  };

  const toggleBotEnabled = (botId: string) => {
    const bot = bots.find((b) => b.id === botId);
    if (!bot) return;
    const nextEnabled = !bot.enabled;
    // Optimistic, and rolled back to the server's answer if the write fails.
    setBotsInCache((prev) => prev.map((b) => (b.id === botId ? { ...b, enabled: nextEnabled } : b)));
    if (editingBot?.id === botId) setEditingBot({ ...editingBot, enabled: nextEnabled });
    updateBotMutation.mutate(
      { id: botId, body: { enabled: nextEnabled } },
      {
        onError: () => {
          setBotsInCache((prev) => prev.map((b) => (b.id === botId ? { ...b, enabled: !nextEnabled } : b)));
          void queryClient.invalidateQueries({ queryKey: queryKeys.bots });
        },
      }
    );
  };

  const saveBot = (updated: BotItem) => {
    setBotsInCache((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    updateBotMutation.mutate({ id: updated.id, body: botToWrite(updated) }, {
      onError: (error) => {
        console.error('Failed to save bot', error);
        void queryClient.invalidateQueries({ queryKey: queryKeys.bots });
      },
    });
  };

  const deleteBot = (botId: string) => {
    deleteBotMutation.mutate(botId, {
      onError: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.bots });
      },
    });
  };

  const confirmAndDeployBot = async (proposed: Partial<BotItem>): Promise<BotItem> => {
    const created = await createBotMutation.mutateAsync({
      name: proposed.name || 'Custom AI Agent',
      name_fa: proposed.nameFa,
      description: proposed.description || 'Custom generated agent built with Agent conversation.',
      description_fa: proposed.descriptionFa,
      avatar_icon: proposed.avatarIcon || 'Bot',
      bot_type: proposed.botType ?? 'agent',
      provider: proposed.provider,
      model_id: proposed.modelId,
      instructions: proposed.instructions || 'You are an intelligent, grounded AI agent.',
      instructions_fa: proposed.instructionsFa,
      tool_ids: proposed.toolIds ?? [],
      knowledge_ids: proposed.knowledgeIds ?? [],
      deterministic_rules: proposed.deterministicRules ?? [],
      temperature: proposed.temperature,
      top_p: proposed.topP,
      max_output_tokens: proposed.maxOutputTokens,
    });
    setSelectedBotId(created.id);
    // Staying in the chat keeps the proposal, its code and the whole history
    // readable; the offer below is how the user opts into the Studio.
    setPendingBotOffer({ botId: created.id, nonce: Date.now() });
    return created;
  };

  const testBotMessage = (message: string) => {
    if (!message.trim() || !editingBot) return;
    const userMsg: ChatMessage = {
      id: `sim-user-${Date.now()}`,
      sender: 'user',
      content: message,
      timestamp: 'Just now',
    };
    const assistantId = `sim-bot-${Date.now()}`;
    setBotSimulationMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, sender: 'bot', content: '', timestamp: 'Streaming', isStreaming: true },
    ]);
    const botId = editingBot.id;
    simulationStreamRef.current?.close();
    void (async () => {
      try {
        const run = await runsApi.create({ bot_id: botId, input: message });
        // Deterministic bots emit no `agent.delta`, so the run record (authoritative and
        // durable) is the only place the final output ever appears. Fetch it on the terminal
        // event instead of racing it once right after creation.
        const finalizeSimulation = async () => {
          try {
            const record = await runsApi.get(run.run_id);
            setBotSimulationMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: m.content || record.output || '',
                      isStreaming: false,
                      timestamp: m.timestamp === 'Streaming' ? 'Just now' : m.timestamp,
                    }
                  : m
              )
            );
          } catch {
            setBotSimulationMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
            );
          }
        };
        const stream = subscribeToRun(run.run_id, {
          onEvent: (event: RunEvent) => {
            if (event.type === 'agent.delta') {
              const text = String(event.data?.text ?? '');
              if (text) {
                setBotSimulationMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m))
                );
              }
            } else if (event.type === 'run.failed') {
              const failure = String(event.data?.message ?? 'The run failed.');
              setBotSimulationMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content || failure, isStreaming: false } : m
                )
              );
            } else if (event.type === 'run.completed') {
              void finalizeSimulation();
            }
          },
          onError: () => void finalizeSimulation(),
          onClose: () => void finalizeSimulation(),
        });
        simulationStreamRef.current = stream;
        void finalizeSimulation();
      } catch (error) {
        setBotSimulationMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: errorMessage(error), isStreaming: false } : m
          )
        );
      }
    })();
  };

  const clearBotSimulation = () => setBotSimulationMessages([]);

  const agentRefineBot = (botId: string, prompt: string) => {
    const current = editingBotRef.current;
    if (!prompt.trim() || !current) return;
    const userMsg: ChatMessage = {
      id: `agent-edit-user-${Date.now()}`,
      sender: 'user',
      content: prompt,
      timestamp: 'Just now',
    };
    setAgentEditMessages((prev) => [...prev, userMsg]);
    setIsAgentEditing(true);
    void (async () => {
      let instructions = current.instructions;
      let temperature = current.temperature;
      let notes = 'Refined via Agent conversation';
      if (/json/i.test(prompt)) {
        instructions += '\n\nFormat all responses strictly as validated JSON schemas.';
        notes = 'Added strict JSON formatting rule';
      }
      if (/concise|short|کوتاه/i.test(prompt)) {
        instructions += '\n\nKeep answers strictly under 3 sentences.';
        notes = 'Enforced brevity guideline';
      }
      if (/temperature|دما/i.test(prompt)) {
        temperature = Math.max(0.0, Math.min(1.0, Number((temperature - 0.1).toFixed(2))));
        notes = `Adjusted temperature to ${temperature.toFixed(2)}`;
      }
      const updated: BotItem = { ...current, instructions, temperature };
      try {
        const saved = await updateBotMutation.mutateAsync({
          id: botId,
          body: { instructions, temperature, bot_type: updated.botType },
        });
        setEditingBot(saved);
        setAgentEditMessages((prev) => [
          ...prev,
          {
            id: `agent-edit-reply-${Date.now()}`,
            sender: 'bot',
            content: `I have updated ${saved.name}:\n- ${notes}\n- Bumped version to ${saved.version}`,
            timestamp: 'Just now',
          },
        ]);
      } catch (error) {
        setAgentEditMessages((prev) => [
          ...prev,
          {
            id: `agent-edit-error-${Date.now()}`,
            sender: 'bot',
            content: `I could not save that change: ${errorMessage(error)}`,
            timestamp: 'Just now',
          },
        ]);
      } finally {
        setIsAgentEditing(false);
      }
    })();
  };

  const clearAgentEditChat = () => setAgentEditMessages([]);
  const dismissBotOffer = () => setPendingBotOffer(null);

  // --- tools --------------------------------------------------------------

  const toggleTool = (toolId: string) => {
    const tool = tools.find((x) => x.id === toolId);
    if (!tool) return;
    const nextEnabled = !tool.enabled;
    // Optimistic, with the same rollback the bot toggle uses.
    queryClient.setQueryData<ToolItem[]>(queryKeys.tools, (prev) =>
      (prev ?? []).map((x) => (x.id === toolId ? { ...x, enabled: nextEnabled } : x)),
    );
    updateToolMutation.mutate(
      { id: toolId, body: { enabled: nextEnabled } },
      {
        onError: () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
        },
      }
    );
  };

  const addTool = (tool: Partial<ToolItem>) => {
    createToolMutation.mutate(toolToWrite(tool), {
      onError: (error) => console.error('Failed to create tool', error),
    });
  };

  const saveToolToWorkspace = async (proposed: Partial<ToolItem>): Promise<ToolItem> =>
    createToolMutation.mutateAsync(toolToWrite(proposed));

  // --- knowledge ----------------------------------------------------------

  const uploadFiles = (files: File[]) => {
    if (files.length === 0) return;
    // The knowledge query polls on its own until indexing settles, so a newly
    // uploaded source reports progress without any timer here.
    uploadKnowledgeMutation.mutate(files, {
      onError: (error) => console.error('Failed to upload knowledge', error),
    });
  };

  // --- account ------------------------------------------------------------

  const resetWorkspaceData = () => {
    void reloadWorkspace();
  };

  const setLocale = (l: SupportedLocale) => setLocaleState(l);

  const handleSetCustomPrimaryColor = (hex: string) => {
    setCustomPrimaryColor(hex);
    setThemePresetId('custom');
  };

  return (
    <WorkspaceContext.Provider
      value={{
        isAuthenticated,
        session,
        profile,
        signIn,
        signUp,
        signOut,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        isMobileDrawerOpen,
        setIsMobileDrawerOpen,
        locale,
        setLocale,
        t,
        isRTL,
        themePresetId,
        setThemePresetId,
        customPrimaryColor,
        setCustomPrimaryColor: handleSetCustomPrimaryColor,
        themeMode,
        setThemeMode,
        agentMode,
        setAgentMode,
        chatMode,
        setChatMode,
        startBotGenerationChat,
        editingBotInChat,
        setEditingBotInChat,
        confirmAndDeployBot,
        saveToolToWorkspace,
        conversations,
        activeConversationId,
        activeConversation,
        startNewChat,
      goToChat,
        selectConversation,
        deleteConversation,
        renameConversation,
        sendMessage,
        composerSeed,
        setComposerSeed,
        clearComposerSeed,
        isStreaming,
        stopStreaming,
        regenerateLastMessage,
        retryLastMessage,
        setMessageFeedback,
        buildProgress,
        artifact,
        artifactStatus,
        isPreviewOpen,
        setIsPreviewOpen,
        openPreview,
        closePreview,
        saveArtifact,
        publishArtifact,
        isBuilding,
        previewMessages,
        sendPreviewMessage,
        isPreviewStreaming,
        clearPreviewMessages,
        bots,
        selectedBotId,
        setSelectedBotId,
        selectedBot,
        editingBot,
        setEditingBot,
        createSimpleBot,
        createSimpleBotFromChat,
        pendingBotOffer,
        dismissBotOffer,
        selectBot,
        saveBot,
        toggleBotEnabled,
        testBotMessage,
        botSimulationMessages,
        clearBotSimulation,
        resetBotSimulation,
        agentRefineBot,
        agentEditMessages,
        clearAgentEditChat,
        isAgentEditing,
        tools,
        toggleTool,
        addTool,
        knowledge,
        uploadFiles,
        account,
        resetWorkspaceData,
        isCommandPaletteOpen,
        setIsCommandPaletteOpen,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
};
