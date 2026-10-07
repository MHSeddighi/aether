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
import {
  BotItem,
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
import { readRoute, writeRoute } from '../lib/router';
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

export type MainSection = 'chat' | 'bots' | 'tools' | 'knowledge' | 'settings';
export type StudioTab = 'playground' | 'overview' | 'billing' | 'code';

export interface StudioOpenRequest {
  botId: string;
  tab: StudioTab;
  nonce: number;
}
export type ChatMode = 'chat' | 'bot-generation';
export type AgentMode = 'agent-bot' | 'simple-bot';

interface WorkspaceContextType {
  // Navigation
  currentSection: MainSection;
  setCurrentSection: (section: MainSection) => void;
  navigate: (route: { section: MainSection | 'auth'; botId?: string; botView?: 'overview' | 'studio' }) => void;

  // Auth
  isAuthenticated: boolean;
  isBooting: boolean;
  session: { name: string; email: string } | null;
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
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, newTitle: string) => void;
  sendMessage: (content: string, attachments?: { name: string; sizeFormatted: string; type: string }[]) => void;
  isStreaming: boolean;
  stopStreaming: () => void;
  regenerateLastMessage: () => void;
  setMessageFeedback: (messageId: string, feedback: 'good' | 'bad') => void;

  // Bots & Studio Workspace
  bots: BotItem[];
  selectedBotId: string;
  setSelectedBotId: (id: string) => void;
  selectedBot: BotItem;
  editingBot: BotItem | null;
  setEditingBot: (bot: BotItem | null) => void;
  openBotInStudio: (bot: BotItem, tab?: StudioTab) => void;
  createAndOpenSimpleBot: (promptText?: string) => Promise<BotItem>;
  studioOpenRequest: StudioOpenRequest | null;
  clearStudioOpenRequest: () => void;
  saveBot: (bot: BotItem) => void;
  toggleBotEnabled: (botId: string) => void;
  testBotMessage: (message: string) => void;
  botSimulationMessages: ChatMessage[];
  clearBotSimulation: () => void;
  resetBotSimulation: (bot: BotItem) => void;
  activeStudioTab: StudioTab;
  setActiveStudioTab: (tab: StudioTab) => void;
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
  temperature: 0.2,
  status: 'draft',
  enabled: false,
  version: '0.0.0',
  versions: [],
  metrics: { totalRuns: 0, avgLatencyMs: 0, tokensConsumed: 0, successRatePercent: 0 },
  lastUsed: 'Never',
};

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

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentSection, setCurrentSection] = useState<MainSection>(() => {
    const initial = readRoute();
    return initial.section === 'auth' ? 'chat' : initial.section;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() =>
    readStorage(STORAGE_KEYS.sidebarCollapsed, false)
  );
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Auth (server-owned session; only the tokens are persisted locally)
  const [session, setSession] = useState<{ name: string; email: string } | null>(null);
  const [account, setAccount] = useState<WorkspaceAccount>(EMPTY_ACCOUNT);
  const [isBooting, setIsBooting] = useState(true);
  const isAuthenticated = session !== null;

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
  const [activeStudioTab, setActiveStudioTab] = useState<StudioTab>('playground');
  const [isAgentEditing, setIsAgentEditing] = useState(false);

  // Domain state (server-owned)
  const [bots, setBots] = useState<BotItem[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>(() =>
    readStorage(STORAGE_KEYS.selectedBotId, '')
  );
  const [editingBot, setEditingBot] = useState<BotItem | null>(null);
  const [studioOpenRequest, setStudioOpenRequest] = useState<StudioOpenRequest | null>(null);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

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
  const knowledgePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bootedRef = useRef(false);

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotId) || bots[0] || FALLBACK_BOT,
    [bots, selectedBotId]
  );

  const activeConversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [conversations, activeConversationId]);

  const patchMessage = useCallback(
    (conversationId: string, messageId: string, patch: (m: ChatMessage) => ChatMessage) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? patch(m) : m)) }
            : c
        )
      );
    },
    []
  );

  // --- data loading -------------------------------------------------------

  const startKnowledgePolling = useCallback(() => {
    if (knowledgePollRef.current) return;
    knowledgePollRef.current = setInterval(() => {
      void knowledgeApi
        .list()
        .then((items) => {
          setKnowledge(items);
          const pending = items.some(
            (item) => item.status === 'Uploading' || item.status === 'Processing' || item.status === 'Indexing'
          );
          if (!pending && knowledgePollRef.current) {
            clearInterval(knowledgePollRef.current);
            knowledgePollRef.current = null;
          }
        })
        .catch(() => {
          if (knowledgePollRef.current) {
            clearInterval(knowledgePollRef.current);
            knowledgePollRef.current = null;
          }
        });
    }, 1500);
  }, []);

  const loadWorkspace = useCallback(async () => {
    const [loadedBots, loadedTools, loadedKnowledge, loadedConversations] = await Promise.all([
      botsApi.list(),
      toolsApi.list(),
      knowledgeApi.list(),
      conversationsApi.list(),
    ]);
    setTools(loadedTools);
    setKnowledge(loadedKnowledge);
    startKnowledgePolling();
    setConversations(loadedConversations.map((c) => ({ ...c, messages: c.messages ?? [] })));

    let nextBots = loadedBots;
    if (nextBots.length === 0) {
      // A brand-new workspace still needs a bot to chat with; seed one default agent.
      try {
        const seeded = await botsApi.create({
          name: 'Assistant',
          description: 'A general-purpose assistant.',
          bot_type: 'agent',
          instructions: 'You are a helpful, concise assistant.',
        });
        nextBots = [seeded];
      } catch {
        nextBots = [];
      }
    }
    setBots(nextBots);
    setSelectedBotId((prev) => (nextBots.some((b) => b.id === prev) ? prev : nextBots[0]?.id ?? ''));
  }, [startKnowledgePolling]);

  const applyAuth = useCallback(
    (user: { name: string; email: string }, workspace: WorkspaceAccount) => {
      setSession({ name: user.name, email: user.email });
      setAccount(workspace);
    },
    []
  );

  // Boot: validate a stored token once, then load the workspace.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void (async () => {
      if (!tokens.access) {
        setIsBooting(false);
        return;
      }
      try {
        const me = await authApi.me();
        applyAuth(me.user, me.workspace);
        await loadWorkspace();
      } catch {
        tokens.clear();
      } finally {
        setIsBooting(false);
      }
    })();
  }, [applyAuth, loadWorkspace]);

  // Clean up any live streams/polls on unmount.
  useEffect(
    () => () => {
      activeRunRef.current?.stream.close();
      simulationStreamRef.current?.close();
      if (knowledgePollRef.current) clearInterval(knowledgePollRef.current);
    },
    []
  );

  // --- auth ---------------------------------------------------------------

  const signIn = async (email: string, password: string) => {
    const result = await authApi.login({ email: email.trim(), password });
    applyAuth(result.user, result.workspace);
    await loadWorkspace();
    setCurrentSection('chat');
    writeRoute({ section: 'chat' });
  };

  const signUp = async (email: string, name: string, password: string) => {
    const result = await authApi.register({ email: email.trim(), name: name.trim(), password });
    applyAuth(result.user, result.workspace);
    await loadWorkspace();
    setCurrentSection('chat');
    writeRoute({ section: 'chat' });
  };

  const signOut = () => {
    void authApi.logout().catch(() => undefined);
    setSession(null);
    setAccount(EMPTY_ACCOUNT);
    setBots([]);
    setTools([]);
    setKnowledge([]);
    setConversations([]);
    setActiveConversationId(null);
    setEditingBot(null);
    setBotSimulationMessages([]);
    writeRoute({ section: 'auth' });
  };

  // --- navigation ---

  useEffect(() => {
    const route = readRoute();
    if (route.section === currentSection && route.section !== 'bots') return;
    if (route.section === 'bots' && currentSection === 'bots') return;
    writeRoute({ section: currentSection });
  }, [currentSection]);

  useEffect(() => {
    if (!isAuthenticated) writeRoute({ section: 'auth' });
  }, [isAuthenticated]);

  useEffect(() => {
    const onHashChange = () => {
      const route = readRoute();
      if (route.section === 'auth') return;
      setCurrentSection(route.section);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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

  const startNewChat = (botId?: string) => {
    setActiveConversationId(null);
    setChatMode('chat');
    setEditingBotInChat(null);
    if (botId) setSelectedBotId(botId);
    setCurrentSection('chat');
    setIsMobileDrawerOpen(false);
  };

  const startBotGenerationChat = () => {
    setActiveConversationId(null);
    setChatMode('bot-generation');
    setEditingBotInChat(null);
    setCurrentSection('chat');
    setIsMobileDrawerOpen(false);
  };

  const selectConversation = (id: string) => {
    setActiveConversationId(id);
    setCurrentSection('chat');
    setIsMobileDrawerOpen(false);
    void (async () => {
      try {
        const full = await conversationsApi.get(id);
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, ...full, messages: full.messages } : c))
        );
        setSelectedBotId(full.botId);
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
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) setActiveConversationId(null);
    void conversationsApi.remove(id).catch(() => undefined);
  };

  const renameConversation = (id: string, newTitle: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c)));
    void conversationsApi.update(id, { title: newTitle }).catch(() => undefined);
  };

  const finalizeRun = useCallback(async (conversationId: string, assistantId: string) => {
    const current = activeRunRef.current;
    if (current && current.assistantId === assistantId) {
      activeRunRef.current = null;
      current.stream.close();
    }
    setIsStreaming(false);
    try {
      const fresh = await conversationsApi.get(conversationId);
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, ...fresh, messages: fresh.messages } : c))
      );
    } catch {
      // Keep whatever was streamed if the refresh fails.
      patchMessage(conversationId, assistantId, (m) => ({ ...m, isStreaming: false }));
    }
  }, [patchMessage]);

  const startRunStream = useCallback(
    (conversationId: string, runId: string, assistantId: string) => {
      activeRunRef.current?.stream.close();
      const stream = subscribeToRun(runId, {
        onEvent: (event: RunEvent) => {
          const eventType = event.data?.type as string | undefined;
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
          const created = await conversationsApi.create({
            bot_id: selectedBotIdRef.current,
            title: text.slice(0, 36) || 'New Conversation',
            mode: agentModeRef.current,
          });
          setConversations((prev) => [{ ...created, messages: [] }, ...prev.filter((c) => c.id !== created.id)]);
          setActiveConversationId(created.id);
          activeConversationIdRef.current = created.id;
        }
        const conversationId = activeConversationIdRef.current as string;
        const result = await conversationsApi.sendMessage(conversationId, {
          content: text,
          attachments: attachments?.map((a) => ({
            name: a.name,
            size_formatted: a.sizeFormatted,
            type: a.type,
          })),
        });
        setConversations((prev) =>
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
          setConversations((prev) =>
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

  const setMessageFeedback = (messageId: string, feedback: 'good' | 'bad') => {
    setConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === messageId ? { ...m, feedback } : m)),
      }))
    );
    void conversationsApi.feedback(messageId, feedback).catch(() => undefined);
  };

  // --- bot studio ---------------------------------------------------------

  const resetBotSimulation = useCallback(
    (bot: BotItem) => {
      setBotSimulationMessages([
        {
          id: `sim-intro-${bot.id}`,
          sender: 'bot',
          content: `Hello! I am ${isRTL ? bot.nameFa || bot.name : bot.name} running on ${bot.model}. Ask me anything to test my responses.`,
          timestamp: 'Ready',
        },
      ]);
    },
    [isRTL]
  );

  const openBotInStudio = (bot: BotItem, tab: StudioTab = 'playground') => {
    setEditingBot(bot);
    setSelectedBotId(bot.id);
    setActiveStudioTab(tab);
    setCurrentSection('bots');
    setStudioOpenRequest({ botId: bot.id, tab, nonce: Date.now() });
    resetBotSimulation(bot);
  };

  const createAndOpenSimpleBot = async (promptText?: string): Promise<BotItem> => {
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
    const created = await botsApi.create({
      name: botName,
      name_fa: botName,
      description: cleanPrompt || 'Deterministic rule-based bot operating without any LLM models.',
      description_fa: cleanPrompt || 'بات قطعی مبتنی بر قانون بدون نیاز به مدل‌های زبانی.',
      avatar_icon: '⚡',
      bot_type: 'simple',
      deterministic_rules: rules,
      instructions: 'Deterministic condition-action rules without models, tools, or knowledge.',
    });
    setBots((prev) => [created, ...prev.filter((b) => b.id !== created.id)]);
    openBotInStudio(created, 'playground');
    return created;
  };

  const toggleBotEnabled = (botId: string) => {
    const bot = bots.find((b) => b.id === botId);
    if (!bot) return;
    const nextEnabled = !bot.enabled;
    setBots((prev) => prev.map((b) => (b.id === botId ? { ...b, enabled: nextEnabled } : b)));
    if (editingBot?.id === botId) setEditingBot({ ...editingBot, enabled: nextEnabled });
    void botsApi
      .update(botId, { enabled: nextEnabled })
      .then((saved) => setBots((prev) => prev.map((b) => (b.id === saved.id ? saved : b))))
      .catch(() => setBots((prev) => prev.map((b) => (b.id === botId ? { ...b, enabled: !nextEnabled } : b))));
  };

  const saveBot = (updated: BotItem) => {
    setBots((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    void botsApi
      .update(updated.id, botToWrite(updated))
      .then((saved) => {
        setBots((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
        setEditingBot((prev) => (prev && prev.id === saved.id ? saved : prev));
      })
      .catch((error) => console.error('Failed to save bot', error));
  };

  const confirmAndDeployBot = async (proposed: Partial<BotItem>): Promise<BotItem> => {
    const created = await botsApi.create({
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
    setBots((prev) => [created, ...prev.filter((b) => b.id !== created.id)]);
    openBotInStudio(created, 'playground');
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
              setBotSimulationMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false, timestamp: 'Just now' } : m))
              );
            }
          },
          onError: () =>
            setBotSimulationMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
            ),
          onClose: () =>
            setBotSimulationMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
            ),
        });
        simulationStreamRef.current = stream;
        void runsApi
          .get(run.run_id)
          .then((record) => {
            if (record.status === 'succeeded' && record.output) {
              // Deltas are live-only; the run record is authoritative if we missed them.
              setBotSimulationMessages((prev) =>
                prev.map((m) => (m.id === assistantId && !m.content ? { ...m, content: record.output ?? '' } : m))
              );
            }
          })
          .catch(() => undefined);
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
        const saved = await botsApi.update(botId, { instructions, temperature, bot_type: updated.botType });
        setBots((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
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
  const clearStudioOpenRequest = () => setStudioOpenRequest(null);

  // --- tools --------------------------------------------------------------

  const toggleTool = (toolId: string) => {
    const tool = tools.find((x) => x.id === toolId);
    if (!tool) return;
    const nextEnabled = !tool.enabled;
    setTools((prev) => prev.map((x) => (x.id === toolId ? { ...x, enabled: nextEnabled } : x)));
    void toolsApi
      .update(toolId, { enabled: nextEnabled })
      .then((saved) => setTools((prev) => prev.map((x) => (x.id === saved.id ? saved : x))))
      .catch(() =>
        setTools((prev) => prev.map((x) => (x.id === toolId ? { ...x, enabled: !nextEnabled } : x)))
      );
  };

  const addTool = (tool: Partial<ToolItem>) => {
    void toolsApi
      .create(toolToWrite(tool))
      .then((created) => setTools((prev) => [created, ...prev]))
      .catch((error) => console.error('Failed to create tool', error));
  };

  const saveToolToWorkspace = async (proposed: Partial<ToolItem>): Promise<ToolItem> => {
    const created = await toolsApi.create(toolToWrite(proposed));
    setTools((prev) => [created, ...prev.filter((t) => t.id !== created.id)]);
    setCurrentSection('tools');
    return created;
  };

  // --- knowledge ----------------------------------------------------------

  const uploadFiles = (files: File[]) => {
    if (files.length === 0) return;
    void (async () => {
      try {
        const created = await knowledgeApi.upload(files);
        setKnowledge((prev) => [...created, ...prev]);
        startKnowledgePolling();
      } catch (error) {
        console.error('Failed to upload knowledge', error);
      }
    })();
  };

  // --- account ------------------------------------------------------------

  const resetWorkspaceData = () => {
    void loadWorkspace().catch(() => undefined);
  };

  const setLocale = (l: SupportedLocale) => setLocaleState(l);

  const navigate = (route: { section: MainSection | 'auth'; botId?: string; botView?: 'overview' | 'studio' }) => {
    writeRoute(route);
    if (route.section !== 'auth') setCurrentSection(route.section);
  };

  const handleSetCustomPrimaryColor = (hex: string) => {
    setCustomPrimaryColor(hex);
    setThemePresetId('custom');
  };

  return (
    <WorkspaceContext.Provider
      value={{
        currentSection,
        setCurrentSection,
        navigate,
        isAuthenticated,
        isBooting,
        session,
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
        selectConversation,
        deleteConversation,
        renameConversation,
        sendMessage,
        isStreaming,
        stopStreaming,
        regenerateLastMessage,
        setMessageFeedback,
        bots,
        selectedBotId,
        setSelectedBotId,
        selectedBot,
        editingBot,
        setEditingBot,
        openBotInStudio,
        createAndOpenSimpleBot,
        studioOpenRequest,
        clearStudioOpenRequest,
        saveBot,
        toggleBotEnabled,
        testBotMessage,
        botSimulationMessages,
        clearBotSimulation,
        resetBotSimulation,
        activeStudioTab,
        setActiveStudioTab,
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
