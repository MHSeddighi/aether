import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import {
  BotItem,
  ToolItem,
  KnowledgeItem,
  ChatConversation,
  ChatMessage,
  WorkspaceAccount,
  BotProposal,
} from '../types/agent';
import {
  mockBots,
  mockTools,
  mockKnowledge,
  mockConversations,
  mockAccount,
} from '../data/mockData';
import { SupportedLocale, translations, Translations } from '../lib/i18n/translations';
import {
  THEME_PRESETS,
  generateMaterial3ThemeTokens,
  applyThemeTokensToDocument,
  ThemeMode,
} from '../lib/theme/themeEngine';
import { readStorage, writeStorage, removeStorage, STORAGE_KEYS } from '../lib/storage';
import { readRoute, writeRoute } from '../lib/router';

export type MainSection = 'chat' | 'bots' | 'tools' | 'knowledge' | 'settings';
export type StudioTab = 'playground' | 'overview' | 'billing' | 'code';

/**
 * One-shot signal used by the Bots playground to decide whether it should jump
 * straight into the studio. It is intentionally a separate piece of state from
 * `editingBot`, because `editingBot` merely means "this bot is the active
 * context" and is mutated by saves, toggles and emoji edits. Deriving
 * navigation from it used to force the studio view on every single entry into
 * the section.
 */
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
  /** Pushes a route (including bot detail views) onto the URL bar. */
  navigate: (route: { section: MainSection | 'auth'; botId?: string; botView?: 'overview' | 'studio' }) => void;

  // Auth
  isAuthenticated: boolean;
  session: { name: string; email: string } | null;
  signIn: (email: string, name?: string) => void;
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
  confirmAndDeployBot: (proposed: Partial<BotItem>) => BotItem;
  saveToolToWorkspace: (proposed: Partial<ToolItem>) => ToolItem;

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

  // Bots & Studio Workspace (Google AI Studio model)
  bots: BotItem[];
  selectedBotId: string;
  setSelectedBotId: (id: string) => void;
  selectedBot: BotItem;
  editingBot: BotItem | null;
  setEditingBot: (bot: BotItem | null) => void;
  openBotInStudio: (bot: BotItem, tab?: StudioTab) => void;
  createAndOpenSimpleBot: (promptText?: string) => BotItem;
  /** Set only when something outside the Bots playground asks to open a bot. */
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
  addKnowledge: (item: Partial<KnowledgeItem>) => void;

  // Account
  account: WorkspaceAccount;
  resetWorkspaceData: () => void;

  // Command Palette
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: (open: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Navigation. Seeded from the URL so a reload lands where the user was.
  const [currentSection, setCurrentSection] = useState<MainSection>(() => {
    const initial = readRoute();
    return initial.section === 'auth' ? 'chat' : initial.section;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() =>
    readStorage(STORAGE_KEYS.sidebarCollapsed, false)
  );
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Auth (local only — there is no backend in this build)
  const [session, setSession] = useState<{ name: string; email: string } | null>(() =>
    readStorage(STORAGE_KEYS.session, null)
  );
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

  // Domain State (persisted)
  const [bots, setBots] = useState<BotItem[]>(() => readStorage(STORAGE_KEYS.bots, mockBots));
  const [selectedBotId, setSelectedBotId] = useState<string>(() =>
    readStorage(STORAGE_KEYS.selectedBotId, mockBots[0].id)
  );
  // Active bot context. Starts empty: entering the Bots section must land on the
  // catalog, not on whichever bot was touched last.
  const [editingBot, setEditingBot] = useState<BotItem | null>(null);
  const [studioOpenRequest, setStudioOpenRequest] = useState<StudioOpenRequest | null>(null);
  const [tools, setTools] = useState<ToolItem[]>(() => readStorage(STORAGE_KEYS.tools, mockTools));
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>(() =>
    readStorage(STORAGE_KEYS.knowledge, mockKnowledge)
  );
  const [conversations, setConversations] = useState<ChatConversation[]>(() =>
    readStorage(STORAGE_KEYS.conversations, mockConversations)
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [account] = useState<WorkspaceAccount>(mockAccount);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Keep the URL in sync with the active section
  useEffect(() => {
    const route = readRoute();
    if (route.section === currentSection && route.section !== 'bots') return;
    if (route.section === 'bots' && currentSection === 'bots') return;
    writeRoute({ section: currentSection });
  }, [currentSection]);

  // Signed-out visitors live on /login
  useEffect(() => {
    if (!isAuthenticated) writeRoute({ section: 'auth' });
  }, [isAuthenticated]);

  // Back/forward navigation
  useEffect(() => {
    const onHashChange = () => {
      const route = readRoute();
      if (route.section === 'auth') return;
      setCurrentSection(route.section);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Persist settings and workspace data
  useEffect(() => writeStorage(STORAGE_KEYS.themeMode, themeMode), [themeMode]);
  useEffect(() => writeStorage(STORAGE_KEYS.themePresetId, themePresetId), [themePresetId]);
  useEffect(() => writeStorage(STORAGE_KEYS.customPrimaryColor, customPrimaryColor), [customPrimaryColor]);
  useEffect(() => writeStorage(STORAGE_KEYS.locale, locale), [locale]);
  useEffect(() => writeStorage(STORAGE_KEYS.sidebarCollapsed, isSidebarCollapsed), [isSidebarCollapsed]);
  useEffect(() => writeStorage(STORAGE_KEYS.bots, bots), [bots]);
  useEffect(() => writeStorage(STORAGE_KEYS.tools, tools), [tools]);
  useEffect(() => writeStorage(STORAGE_KEYS.knowledge, knowledge), [knowledge]);
  useEffect(() => writeStorage(STORAGE_KEYS.conversations, conversations), [conversations]);
  useEffect(() => writeStorage(STORAGE_KEYS.selectedBotId, selectedBotId), [selectedBotId]);

  // Bot Interactive Simulation messages in Studio
  const [botSimulationMessages, setBotSimulationMessages] = useState<ChatMessage[]>([
    {
      id: `sim-intro-${mockBots[0].id}`,
      sender: 'bot',
      content: `Hello! I am ${mockBots[0].name} running on ${mockBots[0].model}. Ask me anything to test my responses.`,
      timestamp: 'Ready',
    },
  ]);

  // Agent Bot Editing Chat in Studio
  const [agentEditMessages, setAgentEditMessages] = useState<ChatMessage[]>([
    {
      id: 'agent-edit-init',
      sender: 'bot',
      content: 'I am your Bot Architecture Agent. Tell me how you would like to refine this bot (e.g. adjust tone, inject safety rules, connect new tools, or lower temperature).',
      timestamp: 'Ready',
    },
  ]);

  // Apply M3 Theme Tokens
  useEffect(() => {
    const primaryHex = customPrimaryColor;
    const isDark =
      themeMode === 'dark' ||
      (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    const tokens = generateMaterial3ThemeTokens(primaryHex, isDark);
    applyThemeTokensToDocument(tokens, isDark);
  }, [themePresetId, customPrimaryColor, themeMode]);

  const selectedBot = useMemo(() => {
    return bots.find((b) => b.id === selectedBotId) || bots[0];
  }, [bots, selectedBotId]);

  const activeConversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [conversations, activeConversationId]);

  // Start New Chat (Home)
  const startNewChat = (botId?: string) => {
    setActiveConversationId(null);
    setChatMode('chat');
    setEditingBotInChat(null);
    if (botId) setSelectedBotId(botId);
    setCurrentSection('chat');
    setIsMobileDrawerOpen(false);
  };

  // Start Bot Generation with Agent
  const startBotGenerationChat = () => {
    setActiveConversationId(null);
    setChatMode('bot-generation');
    setEditingBotInChat(null);
    setCurrentSection('chat');
    setIsMobileDrawerOpen(false);
  };

  const selectConversation = (id: string) => {
    setActiveConversationId(id);
    const found = conversations.find((c) => c.id === id);
    if (found) {
      setSelectedBotId(found.botId);
      if (found.mode === 'simple-bot') {
        setAgentMode('simple-bot');
        setChatMode('bot-generation');
      } else {
        setAgentMode('agent-bot');
        setChatMode('chat');
      }
    }
    setCurrentSection('chat');
    setIsMobileDrawerOpen(false);
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }
  };

  const renameConversation = (id: string, newTitle: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
    );
  };

  // Seed the phone preview with a fresh greeting for the given bot
  const resetBotSimulation = (bot: BotItem) => {
    setBotSimulationMessages([
      {
        id: `sim-intro-${bot.id}`,
        sender: 'bot',
        content: `Hello! I am ${isRTL ? bot.nameFa || bot.name : bot.name} running on ${bot.model}. Ask me anything to test my responses.`,
        timestamp: 'Ready',
      },
    ]);
  };

  // Open a bot in Google AI Studio
  const openBotInStudio = (bot: BotItem, tab: StudioTab = 'playground') => {
    setEditingBot(bot);
    setSelectedBotId(bot.id);
    setActiveStudioTab(tab);
    setCurrentSection('bots');
    setStudioOpenRequest({ botId: bot.id, tab, nonce: Date.now() });
    resetBotSimulation(bot);
  };

  // Create a new Simple Deterministic Bot and directly navigate to its studio playground
  const createAndOpenSimpleBot = (promptText?: string): BotItem => {
    const botId = `bot-simple-${Date.now()}`;
    const cleanPrompt = promptText?.trim() || '';
    const firstWord = cleanPrompt.split(' ')[0]?.toLowerCase() || 'ping';
    const botName = cleanPrompt.length > 0
      ? (cleanPrompt.length > 24 ? `${cleanPrompt.slice(0, 24).trim()}...` : cleanPrompt)
      : `Static Rule Bot #${bots.length + 1}`;

    const rules = [
      { trigger: firstWord, response: `Instant deterministic match for "${cleanPrompt || firstWord}". Latency 0ms.` },
      { trigger: 'ping', response: 'pong! (Instant deterministic execution)' },
      { trigger: 'help', response: 'Available commands: ping, status, help, pricing' },
      { trigger: 'status', response: 'All systems operational. Zero model dependencies.' },
    ];

    const newBot: BotItem = {
      id: botId,
      name: botName,
      nameFa: botName,
      botType: 'simple',
      description: cleanPrompt || 'Deterministic rule-based bot operating without any LLM models.',
      descriptionFa: cleanPrompt || 'بات قطعی مبتنی بر قانون بدون نیاز به مدل‌های زبانی.',
      avatarIcon: '⚡',
      avatarBg: 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]',
      model: 'Deterministic (No Model)',
      instructions: 'Deterministic condition-action rules without models, tools, or knowledge.',
      deterministicRules: rules,
      toolIds: [],
      knowledgeIds: [],
      temperature: 0,
      topP: 1,
      maxOutputTokens: 256,
      status: 'active',
      enabled: true,
      version: '1.0.0',
      versions: [
        { version: '1.0.0', updatedAt: 'Just now', notes: 'Initial deterministic creation', model: 'Deterministic', temperature: 0 },
      ],
      metrics: {
        totalRuns: 1,
        avgLatencyMs: 1,
        tokensConsumed: 0,
        successRatePercent: 100,
      },
      lastUsed: 'Just now',
    };

    setBots((prev) => [newBot, ...prev]);
    setEditingBot(newBot);
    setSelectedBotId(newBot.id);
    setActiveStudioTab('playground');
    setCurrentSection('bots');
    setStudioOpenRequest({ botId: newBot.id, tab: 'playground', nonce: Date.now() });

    // Add session to conversation history so it appears in sidebar
    const newConv: ChatConversation = {
      id: `conv-gen-${Date.now()}`,
      title: `Simple Bot: ${newBot.name}`,
      botId: newBot.id,
      category: 'today',
      updatedAt: 'Just now',
      mode: 'simple-bot',
      messages: [
        {
          id: `msg-create-${Date.now()}`,
          sender: 'bot',
          content: `⚡ Simple Deterministic Bot "${newBot.name}" created with 0ms latency rules. Ready in Studio Playground.`,
          timestamp: 'Just now',
        },
      ],
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newConv.id);

    return newBot;
  };

  // Toggle Bot Active/Disabled state
  const toggleBotEnabled = (botId: string) => {
    setBots((prev) =>
      prev.map((b) => (b.id === botId ? { ...b, enabled: !b.enabled } : b))
    );
    if (editingBot && editingBot.id === botId) {
      setEditingBot((prev) => (prev ? { ...prev, enabled: !prev.enabled } : null));
    }
  };

  // Confirm and Deploy a Bot generated via conversation
  const confirmAndDeployBot = (proposed: Partial<BotItem>): BotItem => {
    const id = `bot-${Date.now()}`;
    const name = proposed.name || 'Custom AI Agent';
    const newBot: BotItem = {
      id,
      name,
      nameFa: proposed.nameFa || name,
      description: proposed.description || 'Custom generated agent built with Agent conversation.',
      descriptionFa: proposed.descriptionFa || 'ایجنت سفارشی تولیدشده از طریق گفتگوی هوشمند.',
      avatarIcon: proposed.avatarIcon || 'Bot',
      avatarBg: 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]',
      model: proposed.model || 'Gemini 2.5 Flash',
      instructions: proposed.instructions || 'You are an intelligent, grounded AI agent.',
      instructionsFa: proposed.instructionsFa || 'شما یک دستیار هوشمند و دقیق هستید.',
      toolIds: proposed.toolIds || ['tool-web-search'],
      knowledgeIds: proposed.knowledgeIds || [],
      temperature: proposed.temperature ?? 0.2,
      topP: proposed.topP ?? 0.95,
      maxOutputTokens: proposed.maxOutputTokens ?? 2048,
      status: 'active',
      enabled: true,
      version: '1.0.0',
      versions: [
        {
          version: '1.0.0',
          updatedAt: 'Just now',
          notes: 'Synthesized and deployed via Agent conversation',
          model: proposed.model || 'Gemini 2.5 Flash',
          temperature: proposed.temperature ?? 0.2,
        },
      ],
      metrics: {
        totalRuns: 0,
        avgLatencyMs: 310,
        tokensConsumed: 0,
        successRatePercent: 100,
      },
      billingUsage: {
        monthlyEstimatedCost: 2.40,
        inputTokens: 120000,
        outputTokens: 64000,
        cachedTokens: 18000,
        costPerThousandRequests: 0.038,
        rpmQuota: 1500,
        tpmQuota: 2000000,
        monthlyBudgetCap: 50.0,
      },
      lastUsed: 'Just now',
      ...proposed,
    };

    setBots((prev) => [newBot, ...prev]);
    openBotInStudio(newBot, 'playground');
    return newBot;
  };

  // Save and register a Tool generated via conversation
  const saveToolToWorkspace = (proposed: Partial<ToolItem>): ToolItem => {
    const id = `tool-${Date.now()}`;
    const name = proposed.name || 'Custom API Connector';
    const newT: ToolItem = {
      id,
      name,
      nameFa: proposed.nameFa || name,
      purpose: proposed.purpose || 'Custom external capability created via agent conversation.',
      purposeFa: proposed.purposeFa || 'ابزار اختصاصی تعریف‌شده از طریق گفتگوی ایجنت.',
      icon: proposed.icon || 'Terminal',
      connectionState: 'Connected',
      category: proposed.category || 'api',
      enabled: true,
      ...proposed,
    };
    setTools((prev) => [newT, ...prev]);
    setCurrentSection('tools');
    return newT;
  };

  // Send message in Chat Workspace
  const sendMessage = (
    content: string,
    attachments?: { name: string; sizeFormatted: string; type: string }[]
  ) => {
    if (!content.trim() && (!attachments || attachments.length === 0)) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      content,
      timestamp: 'Just now',
      attachments,
    };

    let targetConvId = activeConversationId;
    let updatedConversations = [...conversations];

    // If on New Chat, create conversation first
    if (!targetConvId) {
      targetConvId = `chat-${Date.now()}`;
      const title = content.slice(0, 36) || (chatMode === 'bot-generation' ? 'Bot Generation' : 'New Conversation');
      const newConv: ChatConversation = {
        id: targetConvId,
        title,
        botId: selectedBotId,
        category: 'today',
        updatedAt: 'Just now',
        messages: [userMsg],
        mode: agentMode,
      };
      updatedConversations = [newConv, ...conversations];
      setConversations(updatedConversations);
      setActiveConversationId(targetConvId);
    } else {
      updatedConversations = updatedConversations.map((c) =>
        c.id === targetConvId
          ? {
              ...c,
              updatedAt: 'Just now',
              messages: [...c.messages, userMsg],
            }
          : c
      );
      setConversations(updatedConversations);
    }

    setIsStreaming(true);

    const botMsgId = `bot-${Date.now()}`;
    const isBotGenerationQuery =
      chatMode === 'bot-generation' ||
      /bot|agent|سازنده|ایجنت|ساخت|generate|create|build/i.test(content);

    // Initial placeholder message for streaming
    setTimeout(() => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== targetConvId) return c;
          return {
            ...c,
            messages: [
              ...c.messages,
              {
                id: botMsgId,
                sender: 'bot',
                content: '',
                timestamp: 'Just now',
                isStreaming: true,
                knowledgeRetrieval: selectedBot.knowledgeIds.length > 0
                  ? {
                      count: selectedBot.knowledgeIds.length,
                      sources: knowledge
                        .filter((k) => selectedBot.knowledgeIds.includes(k.id))
                        .map((k) => (isRTL ? k.nameFa || k.name : k.name)),
                    }
                  : undefined,
              },
            ],
          };
        })
      );
    }, 400);

    // Stream response completion
    setTimeout(() => {
      if (agentMode === 'simple-bot' || /simple|deterministic|قطعی|قانون/i.test(content)) {
        // Synthesize a Deterministic Simple Bot Proposal (No LLM, no tools, no knowledge)
        const inferredName = content.length > 8 ? content.slice(0, 24).replace(/[^\w\s\u0600-\u06FF]/gi, '').trim() + ' Simple Bot' : 'Keyword Responder';
        const proposedBot: Partial<BotItem> = {
          name: inferredName,
          nameFa: inferredName,
          botType: 'simple',
          description: `Deterministic rule-based bot: "${content.slice(0, 60)}..."`,
          descriptionFa: `بات قطعی و قانون‌محور بدون نیاز به مدل‌های زبانی.`,
          avatarIcon: '⚡',
          avatarBg: 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]',
          model: 'Deterministic (No Model)',
          instructions: `Deterministic workflow for: ${content}.\nProcesses direct triggers without LLMs, external tools, or knowledge.`,
          instructionsFa: `گردش‌کار قطعی و سریع برای کلمات کلیدی، بدون نیاز به مدل زبانی یا ابزار خارجی.`,
          deterministicRules: [
            { trigger: 'ping', response: 'pong! (Instant deterministic execution)' },
            { trigger: 'hello', response: `Hello! I am ${inferredName}, running deterministically.` },
            { trigger: 'status', response: 'System status: OK. 0ms latency.' },
          ],
          toolIds: [],
          knowledgeIds: [],
          temperature: 0,
          topP: 1,
          maxOutputTokens: 256,
        };

        const codeSnippet = `# Deterministic Python Rule Matcher (No LLM or API call needed)
def handle_message(text: str) -> str:
    rules = {
        "ping": "pong!",
        "hello": "Hello! Deterministic instant response.",
        "status": "Operational (0ms latency)"
    }
    for trigger, reply in rules.items():
        if trigger in text.lower():
            return reply
    return "Default deterministic fallback response."
`;

        const proposalContentEn = `I have architected a **Simple Deterministic Bot** blueprint for **${inferredName}**.\n\n- **Bot Type**: Simple Bot (Deterministic & Rule-Based)\n- **Model**: None (Executes with zero token cost and near 0ms latency)\n- **Capabilities**: Pure condition-action triggers without external tools or knowledge\n\nYou can review this deterministic bot below and deploy it to Studio.`;
        const proposalContentFa = `طرح معماری **بات ساده و قطعی** برای **${inferredName}** آماده شد:\n\n- **نوع بات**: بات ساده و قانون‌محور (بدون وابستگی به مدل زبانی)\n- **هزینه و تاخیر**: بدون مصرف توکن با اجرای بلادرنگ (زیر چند میلی‌ثانیه)\n- **ابزارها و دانش**: صفر (کاملاً مستقل و سبک)\n\nمی‌توانید پیش‌نمایش را بررسی کرده و در استودیو باز کنید.`;

        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== targetConvId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === botMsgId
                  ? {
                      ...m,
                      content: isRTL ? proposalContentFa : proposalContentEn,
                      isStreaming: false,
                      botProposal: {
                        proposedBot,
                        codeSnippet,
                      },
                    }
                  : m
              ),
            };
          })
        );
      } else if (isBotGenerationQuery || agentMode === 'agent-bot') {
        // Synthesize an actionable Agent Bot Proposal (with LLM, tools, knowledge, RAG)!
        const inferredName = content.length > 10 ? content.slice(0, 24).replace(/[^\w\s\u0600-\u06FF]/gi, '').trim() + ' Agent' : 'Smart Assistant';
        const proposedBot: Partial<BotItem> = {
          name: inferredName,
          nameFa: inferredName,
          botType: 'agent',
          avatarIcon: '🤖',
          avatarBg: 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]',
          description: `Custom agent synthesized from user specifications: "${content.slice(0, 50)}..."`,
          descriptionFa: `ایجنت هوشمند طراحی‌شده بر اساس مشخصات کاربر با مدل زبانی.`,
          model: content.toLowerCase().includes('reason') || content.toLowerCase().includes('code') ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash',
          temperature: content.toLowerCase().includes('creative') ? 0.7 : 0.2,
          instructions: `You are ${inferredName}.\nPrimary objective: Specialize in fulfilling user goals: ${content}.\nOperational guidelines:\n1. Maintain concise, direct, and factual explanations.\n2. Leverage attached knowledge bases and tools for verification.\n3. Return structured data or code snippets when helpful.`,
          toolIds: content.toLowerCase().includes('sql') ? ['tool-sql-db'] : ['tool-web-search'],
          knowledgeIds: knowledge.slice(0, 1).map((k) => k.id),
        };

        const codeSnippet = `from google import genai\n\nclient = genai.Client()\nresponse = client.models.generate_content(\n    model="${proposedBot.model}",\n    contents="...",\n    config={\n        "system_instruction": """${proposedBot.instructions}""",\n        "temperature": ${proposedBot.temperature},\n    }\n)`;

        const proposalContentEn = `I have analyzed your requirements and architected an optimal **Agent Bot** for **${proposedBot.name}**.\n\n- **Bot Type**: Agent Bot (LLM + Tools + Knowledge)\n- **Model Engine**: ${proposedBot.model} (High reasoning throughput)\n- **System Prompt**: Synthesized with operational constraints and structured responses\n- **Capabilities**: Pre-wired with connected tools and retrieval indices\n\nYou can inspect the proposed blueprint below and deploy it directly into the **Google AI Studio Playground**.`;
        const proposalContentFa = `طرح معماری **ایجنت هوشمند** برای **${proposedBot.name}** آماده شد:\n\n- **نوع بات**: ایجنت هوشمند (مبتنی بر LLM، ابزارها و دانش)\n- **موتور مدل**: ${proposedBot.model} (دقت استدلال بالا)\n- **دستورالعمل‌ها**: تدوین پرامپت با ساختار دقیق\n- **قابلیت‌ها**: متصل به ابزارهای وب و منابع دانش\n\nمی‌توانید طرح را بررسی کرده و در استودیو باز کنید.`;

        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== targetConvId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === botMsgId
                  ? {
                      ...m,
                      content: isRTL ? proposalContentFa : proposalContentEn,
                      isStreaming: false,
                      botProposal: {
                        proposedBot,
                        codeSnippet,
                      },
                    }
                  : m
              ),
            };
          })
        );
      } else {
        // Standard chat response
        const responseTextEn = `Based on your request, I've processed the context with **${selectedBot.name}**:\n\n1. **Analysis & Findings**:\n   - Verified your input against active model instructions and grounding parameters.\n   - Successfully retrieved relevant chunks and aligned outputs.\n\n2. **Next Steps**:\n   - You can test different responses in the **Studio Playground**.\n   - Connected tools are operating within normal latencies.`;
        const responseTextFa = `بر اساس درخواست شما، اطلاعات با استفاده از **${selectedBot.nameFa || selectedBot.name}** بررسی شد:\n\n۱. **یافته‌ها و استدلال**:\n   - درخواست شما با دستورالعمل‌های فعال و منابع متصل مطابقت داده شد.\n   - خروجی با دقت تولید گردید.\n\n۲. **گام‌های بعدی**:\n   - در صورت تمایل می‌توانید در **پلی‌گراند استودیو** پاسخ‌ها را شبیه‌سازی و ارزیابی کنید.`;

        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== targetConvId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === botMsgId
                  ? {
                      ...m,
                      content: isRTL ? responseTextFa : responseTextEn,
                      isStreaming: false,
                    }
                  : m
              ),
            };
          })
        );
      }
      setIsStreaming(false);
    }, 1600);
  };

  const stopStreaming = () => {
    setIsStreaming(false);
  };

  const regenerateLastMessage = () => {
    if (!activeConversation || activeConversation.messages.length === 0) return;
    const lastUserMsg = [...activeConversation.messages].reverse().find((m) => m.sender === 'user');
    if (lastUserMsg) {
      sendMessage(lastUserMsg.content);
    }
  };

  const setMessageFeedback = (messageId: string, feedback: 'good' | 'bad') => {
    if (!activeConversationId) return;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeConversationId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === messageId ? { ...m, feedback } : m
          ),
        };
      })
    );
  };

  // Bot Interactive Simulation Runner in Studio
  const testBotMessage = (message: string) => {
    if (!message.trim() || !editingBot) return;

    const userMsg: ChatMessage = {
      id: `sim-user-${Date.now()}`,
      sender: 'user',
      content: message,
      timestamp: 'Just now',
    };

    setBotSimulationMessages((prev) => [...prev, userMsg]);

    setTimeout(() => {
      if (editingBot.botType === 'simple') {
        const matchingRule = editingBot.deterministicRules?.find((r) =>
          message.toLowerCase().includes(r.trigger.toLowerCase())
        );
        const reply = matchingRule
          ? `[Deterministic Rule Match: "${matchingRule.trigger}"]\n${matchingRule.response}`
          : `[Deterministic Execution (No LLM)]\nProcessed input: "${message}". Zero latency rule execution complete.`;
        const replyFa = matchingRule
          ? `[انطباق قانون قطعی: "${matchingRule.trigger}"]\n${matchingRule.response}`
          : `[اجرای قطعی (بدون مدل زبانی)]\nورودی پردازش شد: "${message}". اجرای بلادرنگ بدون مدل.`;

        setBotSimulationMessages((prev) => [
          ...prev,
          {
            id: `sim-bot-${Date.now()}`,
            sender: 'bot',
            content: isRTL ? replyFa : reply,
            timestamp: 'Instant (1ms)',
          },
        ]);
        return;
      }

      const response = `[${editingBot.model} Simulation · T=${editingBot.temperature}]\nResponse generated according to system instructions:\n"${message}" was processed successfully with ${editingBot.toolIds.length} tools and ${editingBot.knowledgeIds.length} knowledge sources attached.`;
      const responseFa = `[شبیه‌ساز ${editingBot.model} · دما=${editingBot.temperature}]\nپاسخ بر اساس پرامپت سیستم تنظیم شد:\nدرخواست "${message}" با موفقیت پردازش شد. تعداد ابزارهای متصل: ${editingBot.toolIds.length}، تعداد منابع دانش: ${editingBot.knowledgeIds.length}.`;

      setBotSimulationMessages((prev) => [
        ...prev,
        {
          id: `sim-bot-${Date.now()}`,
          sender: 'bot',
          content: isRTL ? responseFa : response,
          timestamp: 'Just now',
        },
      ]);
    }, editingBot.botType === 'simple' ? 50 : 600);
  };

  const clearBotSimulation = () => {
    setBotSimulationMessages([]);
  };

  // Agent Chat to Edit Bot in Studio
  const agentRefineBot = (botId: string, prompt: string) => {
    if (!prompt.trim() || !editingBot) return;

    const userMsg: ChatMessage = {
      id: `agent-edit-user-${Date.now()}`,
      sender: 'user',
      content: prompt,
      timestamp: 'Just now',
    };

    setAgentEditMessages((prev) => [...prev, userMsg]);
    setIsAgentEditing(true);

    setTimeout(() => {
      // Analyze user prompt and synthesize edits
      let updatedInstructions = editingBot.instructions;
      let updatedTemp = editingBot.temperature;
      let notes = 'Refined via Agent conversation';

      if (/json/i.test(prompt)) {
        updatedInstructions += '\n\nFormat all responses strictly as validated JSON schemas.';
        notes = 'Added strict JSON formatting rule';
      }
      if (/concise|short|کوتاه/i.test(prompt)) {
        updatedInstructions += '\n\nKeep answers strictly under 3 sentences.';
        notes = 'Enforced brevity guideline';
      }
      if (/temperature|دما/i.test(prompt)) {
        updatedTemp = Math.max(0.0, Math.min(1.0, updatedTemp - 0.1));
        notes = `Adjusted temperature to ${updatedTemp.toFixed(2)}`;
      }

      const updatedBot: BotItem = {
        ...editingBot,
        instructions: updatedInstructions,
        temperature: updatedTemp,
        version: `1.${parseInt(editingBot.version.split('.')[1] || '0') + 1}.0`,
        versions: [
          {
            version: `1.${parseInt(editingBot.version.split('.')[1] || '0') + 1}.0`,
            updatedAt: 'Just now',
            notes,
            model: editingBot.model,
            temperature: updatedTemp,
          },
          ...editingBot.versions,
        ],
      };

      saveBot(updatedBot);
      setEditingBot(updatedBot);

      const agentReplyEn = `I have updated **${editingBot.name}**:\n- ${notes}\n- Bumped version to **${updatedBot.version}**\n- Instructions and hyperparameters synchronized in the Studio editor.`;
      const agentReplyFa = `تغییرات در **${editingBot.nameFa || editingBot.name}** اعمال شد:\n- ${notes}\n- نسخه به **${updatedBot.version}** ارتقا یافت\n- دستورالعمل‌ها و پارامترها در استودیو همگام‌سازی شدند.`;

      setAgentEditMessages((prev) => [
        ...prev,
        {
          id: `agent-edit-reply-${Date.now()}`,
          sender: 'bot',
          content: isRTL ? agentReplyFa : agentReplyEn,
          timestamp: 'Just now',
        },
      ]);
      setIsAgentEditing(false);
    }, 1000);
  };

  const clearAgentEditChat = () => {
    setAgentEditMessages([]);
  };

  const clearStudioOpenRequest = () => setStudioOpenRequest(null);

  const saveBot = (updated: BotItem) => {
    setBots((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  };

  // Tools
  const toggleTool = (toolId: string) => {
    setTools((prev) =>
      prev.map((t) => (t.id === toolId ? { ...t, enabled: !t.enabled } : t))
    );
  };

  const addTool = (tool: Partial<ToolItem>) => {
    const newT: ToolItem = {
      id: `tool-${Date.now()}`,
      name: tool.name || 'Custom Tool',
      purpose: tool.purpose || 'Custom external capability',
      icon: tool.icon || 'Link',
      connectionState: 'Connected',
      category: tool.category || 'api',
      enabled: true,
      ...tool,
    };
    setTools((prev) => [...prev, newT]);
  };

  // Knowledge
  const uploadFiles = (uploaded: File[]) => {
    uploaded.forEach((file) => {
      const id = `kb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      const newK: KnowledgeItem = {
        id,
        name: file.name,
        type: file.name.endsWith('.csv') ? 'csv' : file.name.endsWith('.pdf') ? 'pdf' : 'doc',
        fileCount: 1,
        sizeFormatted: `${sizeMb} MB`,
        status: 'Uploading',
        progressPercent: 20,
        chunksCount: 0,
        updatedAt: 'Just now',
      };
      setKnowledge((prev) => [newK, ...prev]);
    });
  };

  const addKnowledge = (item: Partial<KnowledgeItem>) => {
    const newK: KnowledgeItem = {
      id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: item.name || 'Untitled Document',
      nameFa: item.nameFa || item.name || 'سند بدون عنوان',
      type: item.type || 'pdf',
      fileCount: item.fileCount || 1,
      sizeFormatted: item.sizeFormatted || '1.2 MB',
      status: item.status || 'Ready',
      progressPercent: item.progressPercent ?? 100,
      chunksCount: item.chunksCount || 24,
      updatedAt: 'Just now',
      ...item,
    };
    setKnowledge((prev) => [newK, ...prev]);
  };

  const resetWorkspaceData = () => {
    setBots(mockBots);
    setTools(mockTools);
    setKnowledge(mockKnowledge);
    setConversations(mockConversations);
    setActiveConversationId(null);
    setEditingBot(null);
    setSelectedBotId(mockBots[0].id);
    setStudioOpenRequest(null);
  };

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

  const setLocale = (l: SupportedLocale) => {
    setLocaleState(l);
  };

  const navigate = (route: { section: MainSection | 'auth'; botId?: string; botView?: 'overview' | 'studio' }) => {
    writeRoute(route);
    if (route.section !== 'auth') {
      setCurrentSection(route.section);
    }
  };

  const signIn = (email: string, name?: string) => {
    const next = {
      email,
      name: name?.trim() || email.split('@')[0] || 'Workspace',
    };
    setSession(next);
    writeStorage(STORAGE_KEYS.session, next);
    setCurrentSection('chat');
    writeRoute({ section: 'chat' });
  };

  const signOut = () => {
    setSession(null);
    removeStorage(STORAGE_KEYS.session);
    writeRoute({ section: 'auth' });
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
        session,
        signIn,
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
        addKnowledge,
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
