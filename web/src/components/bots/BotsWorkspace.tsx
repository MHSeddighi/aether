import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Send,
  Database,
  Wrench,
  Check,
  Copy,
  Code2,
  BarChart3,
  Sparkles,
  Cpu,
  CheckCircle2,
  Bot,
  Smartphone,
  Wifi,
  Battery,
  Plus,
  X,
  Activity,
  Eye,
  EyeOff,
  Search,
  SlidersHorizontal,
  Zap,
  Smile,
  Trash2,
  Paperclip,
  FileText,
} from 'lucide-react';
import { BotItem, BotVersion, BotType, ToolItem } from '../../types/agent';
import { M3Switch } from '../ui/M3Switch';
import { TechLoadingAnimation } from '../ui/TechLoadingAnimation';
import { readRoute, writeRoute } from '../../lib/router';

const EMOJI_CATEGORIES = [
  { id: 'robots', label: 'AI & Tech', emojis: ['🤖', '⚡', '🧠', '🔬', '🛸', '🛰️', '💻', '⚙️', '🔋', '📡', '👾', '🕹️'] },
  { id: 'roles', label: 'Work & Tasks', emojis: ['💼', '📊', '📝', '🎯', '💡', '🔮', '🔒', '🔎', '📈', '📋', '📁', '🎓'] },
  { id: 'characters', label: 'Characters', emojis: ['🐱', '🦊', '🦉', '🐼', '🦁', '🦄', '🐶', '🐙', '🦖', '🐻', '🐰', '🐯'] },
  { id: 'symbols', label: 'Badges', emojis: ['💎', '🌟', '🚀', '🎨', '🛡️', '🌐', '💬', '🏆', '🔥', '✨', '⭐', '🏷️'] },
];

const ALL_BOT_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

export const BotsWorkspace: React.FC = () => {
  const {
    bots,
    setSelectedBotId,
    selectedBot,
    editingBot,
    setEditingBot,
    saveBot,
    toggleBotEnabled,
    createAndOpenSimpleBot,
    testBotMessage,
    botSimulationMessages,
    clearBotSimulation,
    resetBotSimulation,
    setActiveStudioTab,
    studioOpenRequest,
    clearStudioOpenRequest,
    agentRefineBot,
    agentEditMessages,
    clearAgentEditChat,
    isAgentEditing,
    tools,
    knowledge,
    t,
    isRTL,
  } = useWorkspace();

  // Three Clean Architectural Levels:
  // 1. 'list': All Bots catalog
  // 2. 'overview': Bot Statistical & Architecture Deep Dive
  // 3. 'studio': Focused Development Page (Playground with Build & Tune)
  const [viewMode, setViewMode] = useState<'list' | 'overview' | 'studio'>('list');
  // 'overview' when arriving from the catalog, so the back button behaves
  // correctly and the user lands on the review page they asked for.
  const [returnView, setReturnView] = useState<'list' | 'overview'>('list');

  // List view search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'agent' | 'simple' | 'active' | 'draft'>('all');

  // Active bot inside studio/overview
  const currentBot: BotItem = editingBot || selectedBot || bots[0];

  // URL -> view: honour deep links and browser back/forward
  useEffect(() => {
    const applyRoute = () => {
      const route = readRoute();
      if (route.section !== 'bots' || !route.botId) {
        setViewMode('list');
        return;
      }
      const target = bots.find((b) => b.id === route.botId);
      if (!target) {
        setViewMode('list');
        return;
      }
      setSelectedBotId(target.id);
      setEditingBot(target);
      if (route.botView === 'studio') {
        setReturnView('overview');
        setViewMode('studio');
      } else {
        setReturnView('list');
        setViewMode('overview');
      }
    };

    applyRoute();
    window.addEventListener('hashchange', applyRoute);
    return () => window.removeEventListener('hashchange', applyRoute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only react to explicit "open this bot" requests coming from OUTSIDE this
  // component (chat page, command palette, "create simple bot"). Reacting to
  // `editingBot` instead made every visit to the Bots section land in studio.
  useEffect(() => {
    if (!studioOpenRequest) return;
    const target = bots.find((b) => b.id === studioOpenRequest.botId) || selectedBot;
    if (target) {
      setSelectedBotId(target.id);
      setEditingBot(target);
      setActiveStudioTab(studioOpenRequest.tab);
      setReturnView('list');
      if (studioOpenRequest.tab === 'overview') {
        setOverviewSubTab('kpis');
        setViewMode('overview');
        writeRoute({ section: 'bots', botId: target.id, botView: 'overview' });
      } else {
        setPlaygroundSubTab('build');
        setViewMode('studio');
        writeRoute({ section: 'bots', botId: target.id, botView: 'studio' });
      }
    }
    clearStudioOpenRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioOpenRequest?.nonce]);

  // Active Bot Local Configuration Draft
  const [draftBotType, setDraftBotType] = useState<BotType>(currentBot?.botType || 'agent');
  const [draftInstructions, setDraftInstructions] = useState(currentBot?.instructions || '');
  const [draftModel, setDraftModel] = useState(currentBot?.model || 'Gemini 2.5 Flash');
  const [draftTemperature, setDraftTemperature] = useState(currentBot?.temperature ?? 0.2);
  const [draftTopP, setDraftTopP] = useState(currentBot?.topP ?? 0.95);
  const [draftMaxTokens, setDraftMaxTokens] = useState(currentBot?.maxOutputTokens ?? 2048);
  const [draftToolIds, setDraftToolIds] = useState<string[]>(currentBot?.toolIds || []);
  const [draftKnowledgeIds, setDraftKnowledgeIds] = useState<string[]>(currentBot?.knowledgeIds || []);
  const [draftDeterministicRules, setDraftDeterministicRules] = useState<{ trigger: string; response: string }[]>(
    currentBot?.deterministicRules || [
      { trigger: 'ping', response: 'pong! (Instant deterministic execution)' },
      { trigger: 'help', response: 'Commands: ping, status, help, pricing' },
    ]
  );
  const [newTrigger, setNewTrigger] = useState('');
  const [newResponse, setNewResponse] = useState('');

  // Emoji Picker state
  const [emojiPickerTargetBotId, setEmojiPickerTargetBotId] = useState<string | null>(null);
  const [selectedEmojiCategory, setSelectedEmojiCategory] = useState<string>('robots');

  // MCP Servers Attached Draft State
  const [mcpServers, setMcpServers] = useState([
    {
      id: 'mcp-fs',
      name: 'Local Filesystem MCP',
      command: 'npx -y @modelcontextprotocol/server-filesystem /workspace',
      enabled: false,
      status: 'Ready',
    },
    {
      id: 'mcp-pg',
      name: 'PostgreSQL Database MCP',
      command: 'npx -y @modelcontextprotocol/server-postgres postgresql://...',
      enabled: false,
      status: 'Ready',
    },
    {
      id: 'mcp-gh',
      name: 'GitHub Repository MCP',
      command: 'npx -y @modelcontextprotocol/server-github',
      enabled: false,
      status: 'Ready',
    },
  ]);

  // Focused Studio Playground sub-tabs: ONLY 'build' vs 'tune'
  const [playgroundSubTab, setPlaygroundSubTab] = useState<'build' | 'tune'>('build');
  const [isSimPreviewVisible, setIsSimPreviewVisible] = useState(false);

  // Runners & Inputs
  const [simInput, setSimInput] = useState('');
  const [agentEditInput, setAgentEditInput] = useState('');
  const [agentAttachments, setAgentAttachments] = useState<{ name: string; sizeFormatted: string }[]>([]);
  const [codeLang, setCodeLang] = useState<'python' | 'typescript' | 'curl'>('python');
  const [copiedCode, setCopiedCode] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Overview Tab section inside overview mode
  const [overviewSubTab, setOverviewSubTab] = useState<'kpis' | 'telemetry' | 'architecture' | 'code'>('kpis');

  // Sync draft whenever current bot changes
  useEffect(() => {
    if (currentBot) {
      setDraftBotType(currentBot.botType || 'agent');
      setDraftInstructions(currentBot.instructions);
      setDraftModel(currentBot.model);
      setDraftTemperature(currentBot.temperature);
      setDraftTopP(currentBot.topP ?? 0.95);
      setDraftMaxTokens(currentBot.maxOutputTokens ?? 2048);
      setDraftToolIds(currentBot.toolIds || []);
      setDraftKnowledgeIds(currentBot.knowledgeIds || []);
      setDraftDeterministicRules(
        currentBot.deterministicRules || [
          { trigger: 'ping', response: 'pong!' },
          { trigger: 'help', response: 'Available commands: ping, status, help' },
        ]
      );
    }
  }, [currentBot?.id]);

  const goToOverview = (bot: BotItem) => {
    setSelectedBotId(bot.id);
    setEditingBot(bot);
    setReturnView('list');
    setViewMode('overview');
    writeRoute({ section: 'bots', botId: bot.id, botView: 'overview' });
  };

  const goToStudio = (
    bot: BotItem,
    tab: 'playground' | 'overview' | 'billing' | 'code' = 'playground'
  ) => {
    setSelectedBotId(bot.id);
    setEditingBot(bot);
    setActiveStudioTab(tab);
    setPlaygroundSubTab('build');
    // Each bot gets its own preview transcript
    resetBotSimulation(bot);
    // Coming from the review page means "Back" should return to review.
    setReturnView(viewMode === 'overview' ? 'overview' : 'list');
    setViewMode('studio');
    writeRoute({ section: 'bots', botId: bot.id, botView: 'studio' });
  };

  const goToList = () => {
    setViewMode('list');
    writeRoute({ section: 'bots' });
  };

  const handleBackFromStudio = () => {
    if (returnView === 'overview' && currentBot) {
      goToOverview(currentBot);
    } else {
      goToList();
    }
  };

  const handleSavePlaygroundConfig = () => {
    const updated: BotItem = {
      ...currentBot,
      botType: draftBotType,
      instructions: draftInstructions,
      model: draftBotType === 'simple' ? 'Deterministic (No Model)' : draftModel,
      temperature: draftBotType === 'simple' ? 0 : draftTemperature,
      topP: draftBotType === 'simple' ? 1 : draftTopP,
      maxOutputTokens: draftMaxTokens,
      toolIds: draftBotType === 'simple' ? [] : draftToolIds,
      knowledgeIds: draftBotType === 'simple' ? [] : draftKnowledgeIds,
      deterministicRules: draftDeterministicRules,
    };
    saveBot(updated);
    setEditingBot(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleRunSimulation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simInput.trim()) return;
    testBotMessage(simInput);
    setSimInput('');
  };

  const handleAgentFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setAgentAttachments((prev) => [
        ...prev,
        { name: file.name, sizeFormatted: `${sizeMb} MB` },
      ]);
    }
  };

  const handleAgentEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentEditInput.trim() && agentAttachments.length === 0) return;
    const finalPrompt = agentAttachments.length > 0
      ? `${agentEditInput} [Attached spec files: ${agentAttachments.map((a) => a.name).join(', ')}]`
      : agentEditInput;
    agentRefineBot(currentBot.id, finalPrompt);
    setAgentEditInput('');
    setAgentAttachments([]);
  };

  const autoGrowAgent = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handleSelectEmoji = (botId: string, emoji: string) => {
    const targetBot = bots.find((b) => b.id === botId);
    if (targetBot) {
      const updated = { ...targetBot, avatarIcon: emoji };
      saveBot(updated);
      if (editingBot && editingBot.id === botId) {
        setEditingBot(updated);
      }
    }
    setEmojiPickerTargetBotId(null);
  };

  const handleAddDeterministicRule = () => {
    if (!newTrigger.trim() || !newResponse.trim()) return;
    setDraftDeterministicRules((prev) => [
      ...prev,
      { trigger: newTrigger.trim().toLowerCase(), response: newResponse.trim() },
    ]);
    setNewTrigger('');
    setNewResponse('');
  };

  const handleRemoveDeterministicRule = (index: number) => {
    setDraftDeterministicRules((prev) => prev.filter((_, i) => i !== index));
  };

  const renderBotIcon = (bot: BotItem, size = 16) => {
    const isEmoji = bot.avatarIcon && (bot.avatarIcon.length <= 4 || ALL_BOT_EMOJIS.includes(bot.avatarIcon));
    if (isEmoji) {
      return <span className="text-sm md:text-base leading-none select-none">{bot.avatarIcon}</span>;
    }
    return <Bot className="w-4 h-4 text-[var(--md-sys-color-on-surface)] stroke-[1.8]" />;
  };

  const generateCodeSnippet = (bot: BotItem, lang: 'python' | 'typescript' | 'curl') => {
    if (bot.botType === 'simple') {
      if (lang === 'python') {
        return `# Deterministic Bot Runner (0ms latency, Zero token cost)
def run_deterministic_bot(message: str) -> str:
    rules = {
${(bot.deterministicRules || []).map((r) => `        "${r.trigger}": "${r.response}"`).join(',\n')}
    }
    msg_clean = message.lower()
    for trigger, reply in rules.items():
        if trigger in msg_clean:
            return reply
    return "Instant deterministic execution complete."

print(run_deterministic_bot("ping"))`;
      }
      if (lang === 'typescript') {
        return `// Deterministic TypeScript Rule Matcher (0ms latency)
const rules: Record<string, string> = {
${(bot.deterministicRules || []).map((r) => `  "${r.trigger}": "${r.response}"`).join(',\n')}
};

export function evaluateBot(input: string): string {
  const normalized = input.toLowerCase();
  for (const [trigger, reply] of Object.entries(rules)) {
    if (normalized.includes(trigger)) return reply;
  }
  return "Instant deterministic execution complete.";
}`;
      }
      return `# Direct API Execution for Simple Deterministic Bot
curl -X POST https://api.aistudio.build/v1/bots/${bot.id}/execute \\
  -H "Content-Type: application/json" \\
  -d '{"message": "ping"}'`;
    }

    if (lang === 'python') {
      return `# Google AI Studio Client SDK
from google import genai

client = genai.Client()
response = client.models.generate_content(
    model='${bot.model.toLowerCase().replace(/\s+/g, '-')}',
    contents='User query...',
    config={
        'system_instruction': """${bot.instructions}""",
        'temperature': ${bot.temperature},
        'max_output_tokens': ${bot.maxOutputTokens || 2048},
    }
)
print(response.text)`;
    }

    if (lang === 'typescript') {
      return `import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({});
const response = await ai.models.generateContent({
  model: '${bot.model.toLowerCase().replace(/\s+/g, '-')}',
  contents: 'User query...',
  config: {
    systemInstruction: \`${bot.instructions}\`,
    temperature: ${bot.temperature},
    maxOutputTokens: ${bot.maxOutputTokens || 2048},
  }
});
console.log(response.text);`;
    }

    return `curl "https://generativelanguage.googleapis.com/v1beta/models/${bot.model.toLowerCase().replace(/\s+/g, '-')}:generateContent" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{"parts": [{"text": "Hello"}]}],
    "systemInstruction": {"parts": [{"text": "${bot.instructions.slice(0, 50)}..."}]},
    "generationConfig": {"temperature": ${bot.temperature}}
  }'`;
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generateCodeSnippet(currentBot, codeLang));
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const filteredBots = bots.filter((b) => {
    const matchesSearch =
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.nameFa && b.nameFa.includes(searchQuery)) ||
      b.description.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (statusFilter === 'agent') return b.botType === 'agent' || !b.botType;
    if (statusFilter === 'simple') return b.botType === 'simple';
    if (statusFilter === 'active') return b.enabled;
    if (statusFilter === 'draft') return !b.enabled;
    return true;
  });

  const billing = currentBot.billingUsage || {
    monthlyEstimatedCost: 2.4,
    inputTokens: 120000,
    outputTokens: 64000,
    cachedTokens: 18000,
    costPerThousandRequests: 0.038,
    rpmQuota: 1500,
    tpmQuota: 2000000,
    monthlyBudgetCap: 50.0,
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--md-sys-color-surface)] relative">
      {/* Global Emoji Picker Modal */}
      {emojiPickerTargetBotId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setEmojiPickerTargetBotId(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-[var(--md-sys-color-surface-container-high)] shadow-2xl p-5 space-y-4 animate-in zoom-in-95 duration-150 text-start"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <Smile className="w-5 h-5 text-[var(--md-sys-color-on-surface-variant)]" />
                <h3 className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                  {t.selectEmoji}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEmojiPickerTargetBotId(null)}
                className="p-1 rounded-lg text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category tabs */}
            <div className="flex items-center gap-4 overflow-x-auto no-scrollbar border-b border-[var(--md-sys-color-outline-variant)]">
              {EMOJI_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedEmojiCategory(cat.id)}
                  className={`py-1.5 text-[11px] font-medium transition-colors shrink-0 border-b-2 ${
                    selectedEmojiCategory === cat.id
                      ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                      : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Emojis Grid */}
            <div className="grid grid-cols-4 gap-2.5 max-h-56 overflow-y-auto p-1">
              {(EMOJI_CATEGORIES.find((c) => c.id === selectedEmojiCategory)?.emojis || []).map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleSelectEmoji(emojiPickerTargetBotId, emoji)}
                  className="h-11 rounded-lg bg-[var(--md-sys-color-surface-container)] hover:bg-[var(--md-sys-color-secondary-container)] flex items-center justify-center text-2xl transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
         VIEW 1: ALL BOTS CATALOG (LIST)
         ========================================================================= */}
      {viewMode === 'list' && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <header className="h-16 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 md:px-8 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5 text-[var(--md-sys-color-on-surface)]" />
              </div>
              <h1 className="text-sm md:text-base font-semibold text-[var(--md-sys-color-on-surface)] truncate">
                {t.botsTitle}
              </h1>
            </div>

            {/* Quick Create Simple Bot */}
            <button
              type="button"
              onClick={() => createAndOpenSimpleBot()}
              className="h-9 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] font-semibold text-xs flex items-center gap-1.5 hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors shrink-0"
            >
              <Zap className="w-4 h-4" />
              <span>{isRTL ? 'ساخت بات ساده' : 'Create Simple Bot'}</span>
            </button>
          </header>

          {/* Sub-header Filter & Search Bar */}
          <div className="border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 md:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-[var(--md-sys-color-on-surface-variant)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full ps-9 pe-3 py-1.5 rounded-lg bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none"
                dir={isRTL ? 'rtl' : 'ltr'}
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-4 w-full sm:w-auto overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`flex-1 sm:flex-none py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  statusFilter === 'all'
                    ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                    : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                }`}
              >
                {t.filterAll}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('simple')}
                className={`flex-1 sm:flex-none py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  statusFilter === 'simple'
                    ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                    : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                }`}
              >
                {t.filterSimple}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('agent')}
                className={`flex-1 sm:flex-none py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  statusFilter === 'agent'
                    ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                    : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                }`}
              >
                {t.filterAgent}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`flex-1 sm:flex-none py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  statusFilter === 'active'
                    ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                    : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                }`}
              >
                {t.filterActive}
              </button>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 md:gap-4">
                {filteredBots.map((bot) => {
                  return (
                    <div
                      key={bot.id}
                      className="group w-full min-w-0 flex flex-col rounded-lg bg-[var(--md-sys-color-surface-container)] hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors overflow-hidden"
                    >
                      {/* HEADER — identity + status only. A div, not a button: it contains the
                          M3Switch (itself a button), and nested buttons are invalid HTML. */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => goToOverview(bot)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            goToOverview(bot);
                          }
                        }}
                        className="w-full flex items-center gap-2.5 p-3.5 text-start min-w-0 cursor-pointer"
                      >
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setEmojiPickerTargetBotId(bot.id);
                          }}
                          className="w-9 h-9 rounded-lg bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0 text-[var(--md-sys-color-on-surface)]"
                          title={t.changeIcon}
                        >
                          {renderBotIcon(bot)}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block text-xs md:text-sm font-semibold truncate text-[var(--md-sys-color-on-surface)]">
                            {isRTL ? bot.nameFa || bot.name : bot.name}
                          </span>
                        </span>

                        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <M3Switch
                            checked={bot.enabled}
                            onChange={() => toggleBotEnabled(bot.id)}
                            ariaLabel={
                              bot.enabled
                                ? `${bot.name} — ${t.unpublishBot}`
                                : `${bot.name} — ${t.publishBot}`
                            }
                          />
                        </span>
                      </div>

                      {/* CONTENT — description only */}
                      <div className="px-3.5 pb-3.5 min-w-0">
                        <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] line-clamp-2 leading-relaxed break-words">
                          {isRTL ? bot.descriptionFa || bot.description : bot.description}
                        </p>
                      </div>

                      {/* FOOTER — primary + secondary actions, clear hierarchy */}
                      <div className="mt-auto flex items-center gap-1.5 px-3.5 py-2.5 border-t border-[var(--md-sys-color-outline-variant)]">
                        <button
                          type="button"
                          onClick={() => goToStudio(bot, 'playground')}
                          className="h-8 px-3 rounded-lg bg-[var(--md-sys-color-surface-container-high)] hover:bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>{t.openInStudio}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => goToOverview(bot)}
                          className="h-8 px-3 rounded-lg text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <BarChart3 className="w-3.5 h-3.5" />
                          <span>{t.botOverview}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
         VIEW 2: BOT STATISTICAL & ARCHITECTURAL OVERVIEW
         (Separated from development, with sections and prominent "Open Studio" button!)
         ========================================================================= */}
      {viewMode === 'overview' && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Executive Header */}
          <header className="h-14 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 md:px-8 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={goToList}
                className="h-9 px-2.5 rounded-lg hover:bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] font-medium flex items-center gap-1 transition-colors"
              >
                {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                <span>{t.allBots}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEmojiPickerTargetBotId(currentBot.id)}
                  className="w-8 h-8 rounded-lg bg-[var(--md-sys-color-surface-container-high)] hover:bg-[var(--md-sys-color-surface-container-highest)] flex items-center justify-center text-[var(--md-sys-color-on-surface)] transition-colors"
                  title={t.changeIcon}
                >
                  {renderBotIcon(currentBot)}
                </button>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-xs md:text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                    {isRTL ? currentBot.nameFa || currentBot.name : currentBot.name}
                  </h2>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]">
                    v{currentBot.version}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: bare status switch + secondary-weight studio entry */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <M3Switch
                  checked={currentBot.enabled}
                  onChange={() => toggleBotEnabled(currentBot.id)}
                  ariaLabel="Toggle active status"
                />
                <span className="hidden sm:inline text-xs text-[var(--md-sys-color-on-surface-variant)]">
                  {currentBot.enabled ? t.published : t.unpublished}
                </span>
              </div>

              <button
                type="button"
                onClick={() => goToStudio(currentBot, 'playground')}
                className="h-9 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] font-semibold text-xs flex items-center gap-1.5 hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t.developBot}</span>
              </button>
            </div>
          </header>

          {/* Sub Navigation Bar for Overview */}
          <div className="border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 md:px-8 flex items-center gap-5 overflow-x-auto no-scrollbar shrink-0">
            <button
              type="button"
              onClick={() => setOverviewSubTab('kpis')}
              className={`h-10 px-0 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                overviewSubTab === 'kpis'
                  ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                  : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>{t.overviewMetrics}</span>
            </button>
            <button
              type="button"
              onClick={() => setOverviewSubTab('telemetry')}
              className={`h-10 px-0 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                overviewSubTab === 'telemetry'
                  ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                  : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{isRTL ? 'نظارت و تلمتری' : 'Observability & Logs'}</span>
            </button>
            <button
              type="button"
              onClick={() => setOverviewSubTab('architecture')}
              className={`h-10 px-0 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                overviewSubTab === 'architecture'
                  ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                  : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{isRTL ? 'معماری و قوانین' : 'Architecture & Rules'}</span>
            </button>
            <button
              type="button"
              onClick={() => setOverviewSubTab('code')}
              className={`h-10 px-0 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                overviewSubTab === 'code'
                  ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                  : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>{t.getCode}</span>
            </button>
          </div>

          {/* Overview Content Body */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Hero Summary — text only, the header already carries name/version/icon */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold ${
                    currentBot.botType === 'simple'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]'
                  }`}
                >
                  {currentBot.botType === 'simple' ? '⚡ Simple Static Bot (0ms)' : `🤖 ${currentBot.model}`}
                </span>
                <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] max-w-2xl">
                  {isRTL ? currentBot.descriptionFa || currentBot.description : currentBot.description}
                </p>
              </div>

              {/* Sub-tab 1: KPIs & Metrics */}
              {overviewSubTab === 'kpis' && (
                <div className="space-y-6">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                    <div className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                        {t.totalRuns}
                      </span>
                      <p className="text-2xl font-bold font-mono text-[var(--md-sys-color-on-surface)]">
                        {currentBot.metrics.totalRuns.toLocaleString()}
                      </p>
                      <span className="text-[10px] text-emerald-500 font-mono">100% operational</span>
                    </div>

                    <div className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                        {t.avgLatency}
                      </span>
                      <p className="text-2xl font-bold font-mono text-[var(--md-sys-color-on-surface)]">
                        {currentBot.botType === 'simple' ? '0.8 ms' : `${currentBot.metrics.avgLatencyMs} ms`}
                      </p>
                      <span className="text-[10px] text-emerald-500 font-mono">
                        {currentBot.botType === 'simple' ? 'Instant Zero-Latency' : 'P99: 450ms'}
                      </span>
                    </div>

                    <div className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                        {t.successRate}
                      </span>
                      <p className="text-2xl font-bold font-mono text-emerald-500">
                        {currentBot.metrics.successRatePercent}%
                      </p>
                      <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] font-mono">0 failed invocations</span>
                    </div>

                    <div className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                        {t.tokensConsumed}
                      </span>
                      <p className="text-2xl font-bold font-mono text-[var(--md-sys-color-on-surface)]">
                        {currentBot.botType === 'simple' ? '0 (No LLM)' : `${(currentBot.metrics.tokensConsumed / 1000000).toFixed(1)}M`}
                      </p>
                      <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] font-mono">
                        {currentBot.botType === 'simple' ? '$0.00 cost' : `$${billing.monthlyEstimatedCost.toFixed(2)} / mo`}
                      </span>
                    </div>
                  </div>

                  {/* Version History */}
                  <div className="p-4 md:p-5 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-3">
                    <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)] uppercase font-mono tracking-wider">
                      {t.versionHistory}
                    </h3>
                    <div className="space-y-2">
                      {currentBot.versions.map((v) => (
                        <div
                          key={v.version}
                          className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)] flex items-center justify-between text-xs"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold">v{v.version}</span>
                              <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)]">{v.updatedAt}</span>
                            </div>
                            <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">{v.notes}</p>
                          </div>
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]">
                            {v.model}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-tab 2: Telemetry & Latency Observatory */}
              {overviewSubTab === 'telemetry' && (
                <div className="p-4 md:p-5 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                        {isRTL ? 'نظارت بلادرنگ بر کارکرد بات' : 'Real-Time Invocations Telemetry'}
                      </h3>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live Stream
                    </span>
                  </div>

                  {/* Synthetic execution log */}
                  <div className="space-y-2">
                    {[
                      { query: 'ping', latency: currentBot.botType === 'simple' ? '0.7ms' : '290ms', status: 'Success 200', time: 'Just now' },
                      { query: 'status check', latency: currentBot.botType === 'simple' ? '0.9ms' : '310ms', status: 'Success 200', time: '2 mins ago' },
                      { query: 'health telemetry', latency: currentBot.botType === 'simple' ? '0.8ms' : '340ms', status: 'Success 200', time: '5 mins ago' },
                      { query: 'sample trigger test', latency: currentBot.botType === 'simple' ? '1.1ms' : '305ms', status: 'Success 200', time: '12 mins ago' },
                    ].map((log, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)] flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          <div>
                            <span className="font-mono font-medium text-[var(--md-sys-color-on-surface)]">
                              "{log.query}"
                            </span>
                            <span className="block text-[10px] text-[var(--md-sys-color-on-surface-variant)]">
                              {log.time}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 font-mono text-[11px]">
                          <span className="text-[var(--md-sys-color-on-surface-variant)]">{log.latency}</span>
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold">
                            {log.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-tab 3: Architecture & Rules Profile */}
              {overviewSubTab === 'architecture' && (
                <div className="p-4 md:p-5 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                        {currentBot.botType === 'simple'
                          ? (isRTL ? 'قوانین و رفتارهای قطعی' : 'Deterministic Condition-Action Triggers')
                          : (isRTL ? 'معماری و پرامپت سیستم' : 'Model Architecture & Attached Integrations')}
                      </h3>
                    </div>

                    </div>

                  {currentBot.botType === 'simple' ? (
                    <div className="space-y-2">
                      {(currentBot.deterministicRules || []).map((rule, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)] flex items-start justify-between text-xs"
                        >
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-mono font-semibold text-[var(--md-sys-color-primary)] block">
                              IF contains "{rule.trigger}"
                            </span>
                            <p className="text-xs text-[var(--md-sys-color-on-surface)]">{rule.response}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[10px] font-semibold">
                            0ms Execution
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="p-3.5 rounded-lg bg-[var(--md-sys-color-surface-container)] text-xs font-mono">
                        <span className="text-[10px] uppercase font-semibold text-[var(--md-sys-color-on-surface-variant)] block mb-1">
                          System Prompt Instructions:
                        </span>
                        <p className="text-xs text-[var(--md-sys-color-on-surface)] whitespace-pre-line">
                          {currentBot.instructions}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-mono text-[var(--md-sys-color-on-surface-variant)]">
                        <span>Tools: {currentBot.toolIds.length} connected</span>
                        <span>·</span>
                        <span>Knowledge: {currentBot.knowledgeIds.length} documents attached</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tab 4: Get Code */}
              {overviewSubTab === 'code' && (
                <div className="p-4 md:p-5 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">{t.getCode}</h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-3">
                        {(['python', 'typescript', 'curl'] as const).map((lang) => (
                          <button
                            key={lang}
                            type="button"
                            onClick={() => setCodeLang(lang)}
                            className={`py-1 text-xs font-mono uppercase border-b-2 transition-colors ${
                              codeLang === lang
                                ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                                : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                            }`}
                          >
                            {lang}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container)] transition-colors flex items-center gap-1"
                      >
                        {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedCode ? t.copied : t.copyCode}</span>
                      </button>
                    </div>
                  </div>

                  <pre className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-lowest)] font-mono text-xs overflow-x-auto text-[var(--md-sys-color-on-surface)]">
                    {generateCodeSnippet(currentBot, codeLang)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
         VIEW 3: INSIDE THE BOT (STUDIO PLAYGROUND / DEVELOPMENT PAGE)
         - Redesigned, compact header (no longer long and cluttered!)
         - Preview button cleanly located at the RIGHT TOP of the playground!
         - Removed example chips above the agent input & added file attachments!
         - Removed primary color border around the agent input!
         - Always shows ONE tune rules and configs strictly based on the bot type!
         ========================================================================= */}
      {viewMode === 'studio' && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Top Compact Navbar (Redesigned like Big Tech: clean, minimal, distraction-free) */}
          <header className="h-14 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 md:px-6 flex items-center justify-between gap-3 shrink-0 relative z-30">
            {/* Left: Back to Overview + Active Bot Identity + Status */}
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={handleBackFromStudio}
                className="h-9 px-2.5 rounded-lg text-xs text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container)] font-medium flex items-center gap-1 transition-colors shrink-0"
                title={returnView === 'overview' ? t.backToOverview : t.allBots}
              >
                {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                <span className="hidden sm:inline">
                  {returnView === 'overview' ? t.backToOverview : t.allBots}
                </span>
              </button>

              {/* Bot Icon & Name with Emoji picker trigger */}
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setEmojiPickerTargetBotId(currentBot.id)}
                  className="shrink-0"
                  title={t.changeIcon}
                >
                  {renderBotIcon(currentBot)}
                </button>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-semibold text-[var(--md-sys-color-on-surface)] truncate max-w-[140px] md:max-w-[200px]">
                    {isRTL ? currentBot.nameFa || currentBot.name : currentBot.name}
                  </span>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-semibold shrink-0 ${
                      draftBotType === 'simple'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]'
                    }`}
                  >
                    {draftBotType === 'simple' ? '⚡ 0ms' : `🤖 ${draftModel}`}
                  </span>
                </div>
              </div>

              {/* Status Switch — bare, no surrounding box */}
              <div className="flex items-center shrink-0">
                <M3Switch
                  checked={currentBot.enabled}
                  onChange={() => toggleBotEnabled(currentBot.id)}
                  ariaLabel="Toggle active status"
                />
                <span className="hidden lg:inline ms-1.5 text-xs text-[var(--md-sys-color-on-surface-variant)]">
                  {currentBot.enabled ? t.published : t.unpublished}
                </span>
              </div>
            </div>

            {/* Right: PREVIEW toggle + Save Changes */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setIsSimPreviewVisible(!isSimPreviewVisible)}
                className={`h-9 px-3 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  isSimPreviewVisible
                    ? 'bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] font-semibold'
                    : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container)]'
                }`}
                title={isSimPreviewVisible ? t.hidePreview : t.preview}
              >
                {isSimPreviewVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">{isSimPreviewVisible ? t.hidePreview : t.preview}</span>
              </button>

              {/* Save Changes — neutral weight, it is a routine action */}
              <button
                type="button"
                onClick={handleSavePlaygroundConfig}
                className="h-9 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] font-semibold text-xs hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors flex items-center gap-1.5"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>{t.applied}</span>
                  </>
                ) : (
                  <span>{t.saveChanges}</span>
                )}
              </button>
            </div>
          </header>

          {/* Sub-bar with ONLY Build and Tune tabs */}
          <div className="h-11 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 md:px-6 flex items-center justify-between shrink-0">
            {/* Segmented control: hairline underline instead of a filled pill container */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setPlaygroundSubTab('build')}
                className={`h-11 px-0 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                  playgroundSubTab === 'build'
                    ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                    : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t.build}</span>
              </button>

              <button
                type="button"
                onClick={() => setPlaygroundSubTab('tune')}
                className={`h-11 px-0 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                  playgroundSubTab === 'tune'
                    ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                    : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{t.tune}</span>
              </button>
            </div>

          </div>

          {/* Playground Main Layout */}
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-[var(--md-sys-color-surface)]">
            <section className="flex-1 border-b lg:border-b-0 lg:border-e border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] flex flex-col h-full overflow-hidden">
              {/* SUB-TAB 1: BUILD (Agent Chat specifically for bot architecture) */}
              {playgroundSubTab === 'build' && (
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  {/* Meta-Agent Conversation Feed */}
                  <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3.5">
                    {agentEditMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 text-xs md:text-sm ${
                          msg.sender === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        {msg.sender === 'bot' && (
                          <div className="w-7 h-7 rounded-lg bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0 mt-0.5 text-[var(--md-sys-color-on-surface)]">
                            <Bot className="w-4 h-4" />
                          </div>
                        )}
                        <div
                          className={`p-3.5 rounded-xl max-w-xl leading-relaxed ${
                            msg.sender === 'user'
                              ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] rounded-br-xs font-medium'
                              : 'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)] rounded-bl-xs'
                          }`}
                          dir={isRTL ? 'rtl' : 'ltr'}
                        >
                          <div className="whitespace-pre-line">{msg.content}</div>
                        </div>
                      </div>
                    ))}

                    {isAgentEditing && (
                      <div className="p-3 flex items-center gap-2.5 text-xs text-[var(--md-sys-color-on-surface-variant)] font-mono">
                        <TechLoadingAnimation variant="circular" size="sm" />
                        <span>Synthesizing bot rules and architecture...</span>
                      </div>
                    )}
                  </div>

                  {/* Agent Builder composer: query on line 1, icon actions on line 2 */}
                  <div className="p-3 md:p-4 border-t border-[var(--md-sys-color-outline-variant)] bg-transparent">
                    <form
                      onSubmit={handleAgentEditSubmit}
                      className="relative rounded-2xl bg-[var(--md-sys-color-surface-container)]"
                    >
                      <textarea
                        rows={1}
                        value={agentEditInput}
                        onChange={(e) => {
                          setAgentEditInput(e.target.value);
                          autoGrowAgent(e.target);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAgentEditSubmit(e);
                          }
                        }}
                        placeholder={
                          draftBotType === 'simple'
                            ? (isRTL ? 'دستور جدید یا کلمه کلیدی را بنویسید (مثلاً: اضافه کردن قانون برای قیمت‌ها)...' : 'Describe rules to add or refine (e.g. Add pricing trigger, return $99)...')
                            : t.botBuildingPlaceholder
                        }
                        className="w-full px-4 pt-3.5 pb-1 bg-transparent text-xs text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] outline-none focus:outline-none focus-visible:outline-none resize-none leading-relaxed max-h-[200px] overflow-y-auto"
                        dir={isRTL ? 'rtl' : 'ltr'}
                      />

                      {agentAttachments.length > 0 && (
                        <div className="px-4 pt-1 flex flex-wrap gap-1.5">
                          {agentAttachments.map((att, idx) => (
                            <span
                              key={idx}
                              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--md-sys-color-surface-container-high)] text-[11px] text-[var(--md-sys-color-on-surface)]"
                            >
                              <FileText className="w-3 h-3 text-[var(--md-sys-color-on-surface-variant)]" />
                              <span className="truncate max-w-[120px]">{att.name}</span>
                              <button
                                type="button"
                                onClick={() => setAgentAttachments((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]"
                                title={t.clearChat}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-1 px-2.5 py-2">
                        <div className="flex items-center gap-0.5">
                          <label
                            className="w-8 h-8 rounded-lg cursor-pointer text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors flex items-center justify-center"
                            title={t.attachFiles}
                          >
                            <Paperclip className="w-4 h-4" />
                            <input type="file" className="hidden" onChange={handleAgentFileAttach} />
                          </label>

                          <button
                            type="button"
                            onClick={clearAgentEditChat}
                            className="w-8 h-8 rounded-lg text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors flex items-center justify-center"
                            title={t.clearChat}
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </div>

                        <button
                          type="submit"
                          disabled={(!agentEditInput.trim() && agentAttachments.length === 0) || isAgentEditing}
                          className="w-8 h-8 rounded-lg bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center shrink-0"
                          title={t.send}
                        >
                          <Send className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* SUB-TAB 2: TUNE (Always show ONE tune rules & configs strictly based on bot type!) */}
              {playgroundSubTab === 'tune' && (
                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
                  {/* CASE 1: SIMPLE DETERMINISTIC BOT (NO LLM, NO TOOLS, NO KNOWLEDGE!) */}
                  {draftBotType === 'simple' ? (
                    <div className="p-4 md:p-5 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-5">
                      <div className="flex items-center justify-between pb-3 border-b border-[var(--md-sys-color-outline-variant)]">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400">
                            <Zap className="w-4 h-4" />
                          </div>
                          <div>
                            <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                              {t.deterministicRules}
                            </h3>
                          </div>
                        </div>

                        <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold">
                          0ms Latency Guaranteed
                        </span>
                      </div>

                      {/* Add New Rule */}
                      <div className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container)] space-y-3">
                        <span className="text-xs font-semibold text-[var(--md-sys-color-on-surface)] block">
                          {isRTL ? 'افزودن قانون جدید' : 'Add New Trigger Condition'}
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={newTrigger}
                            onChange={(e) => setNewTrigger(e.target.value)}
                            placeholder={isRTL ? 'کلمه کلیدی (مثلاً: ping)...' : 'Trigger keyword (e.g. ping)...'}
                            className="px-3 py-2 rounded-lg bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface)] focus:outline-none"
                          />
                          <input
                            type="text"
                            value={newResponse}
                            onChange={(e) => setNewResponse(e.target.value)}
                            placeholder={isRTL ? 'پاسخ قطعی (مثلاً: pong)...' : 'Instant response (e.g. pong!)...'}
                            className="px-3 py-2 rounded-lg bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface)] focus:outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleAddDeterministicRule}
                          disabled={!newTrigger.trim() || !newResponse.trim()}
                          className="h-8 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] text-xs font-semibold hover:bg-[var(--md-sys-color-surface-container-highest)] disabled:opacity-40 transition-colors flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isRTL ? 'ثبت قانون' : 'Add Rule'}</span>
                        </button>
                      </div>

                      {/* Rules List (Limited Height max-h-56 & Scrollable) */}
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-[var(--md-sys-color-on-surface)] block">
                          {isRTL ? 'قوانین فعال بات' : 'Configured Rule Triggers'} ({draftDeterministicRules.length})
                        </span>
                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                          {draftDeterministicRules.map((rule, idx) => (
                            <div
                              key={idx}
                              className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)] flex items-start justify-between gap-3 text-xs"
                            >
                              <div className="space-y-0.5 min-w-0">
                                <span className="text-[10px] font-mono font-semibold text-[var(--md-sys-color-primary)] block">
                                  IF input contains "{rule.trigger}"
                                </span>
                                <p className="text-xs text-[var(--md-sys-color-on-surface)]">{rule.response}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveDeterministicRule(idx)}
                                className="p-1 text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-error)]"
                                title="Delete rule"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* CASE 2: AGENT BOT (LLM MODELS, TOOLS, KNOWLEDGE) */
                    <div className="space-y-6">
                      {/* Section 1: System Instructions */}
                      <div className="p-4 md:p-4 md:p-5 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                            {t.systemInstructions}
                          </h3>
                          <span className="text-[10px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
                            Markdown supported
                          </span>
                        </div>
                        <textarea
                          rows={4}
                          value={draftInstructions}
                          onChange={(e) => setDraftInstructions(e.target.value)}
                          placeholder="You are an expert AI assistant..."
                          className="w-full p-3 rounded-lg bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none leading-relaxed"
                          dir={isRTL ? 'rtl' : 'ltr'}
                        />
                      </div>

                      {/* Section 2: Model & Hyperparameters */}
                      <div className="p-4 md:p-4 md:p-5 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-4">
                        <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                          {t.modelParameters}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <label className="text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
                              Model
                            </label>
                            <select
                              value={draftModel}
                              onChange={(e) => setDraftModel(e.target.value)}
                              className="w-full h-9 px-2 rounded-lg bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface)] focus:outline-none"
                            >
                              <option value="Gemini 2.5 Flash">Gemini 2.5 Flash (Fast)</option>
                              <option value="Gemini 2.5 Pro">Gemini 2.5 Pro (Reasoning)</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
                              <span>Temperature</span>
                              <span className="font-mono">{draftTemperature}</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={draftTemperature}
                              onChange={(e) => setDraftTemperature(parseFloat(e.target.value))}
                              className="w-full accent-[var(--md-sys-color-primary)]"
                            />
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
                              <span>Max Tokens</span>
                              <span className="font-mono">{draftMaxTokens}</span>
                            </div>
                            <input
                              type="range"
                              min="256"
                              max="8192"
                              step="256"
                              value={draftMaxTokens}
                              onChange={(e) => setDraftMaxTokens(parseInt(e.target.value))}
                              className="w-full accent-[var(--md-sys-color-primary)]"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section 3: Tools Integration Switchboard (Limited Height & Scrollable) */}
                      <div className="p-4 md:p-4 md:p-5 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                            {t.tools} ({draftToolIds.length} connected)
                          </h3>
                        </div>

                        <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                          {tools.map((tl) => {
                            const isAttached = draftToolIds.includes(tl.id);
                            return (
                              <div
                                key={tl.id}
                                className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)] flex items-center justify-between gap-3 text-xs"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-7 h-7 rounded-md bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0">
                                    <Wrench className="w-3.5 h-3.5" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-medium text-[var(--md-sys-color-on-surface)] truncate">
                                      {isRTL ? tl.nameFa || tl.name : tl.name}
                                    </p>
                                    <p className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] truncate">
                                      {tl.purpose}
                                    </p>
                                  </div>
                                </div>
                                <M3Switch
                                  checked={isAttached}
                                  onChange={() => {
                                    setDraftToolIds((prev) =>
                                      isAttached ? prev.filter((id) => id !== tl.id) : [...prev, tl.id]
                                    );
                                  }}
                                  ariaLabel={`Attach ${tl.name}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Section 4: Connected Knowledge Bases (Limited Height & Scrollable) */}
                      <div className="p-4 md:p-4 md:p-5 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                            {t.connectedKnowledge} ({draftKnowledgeIds.length} attached)
                          </h3>
                        </div>

                        <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                          {knowledge.map((kn) => {
                            const isAttached = draftKnowledgeIds.includes(kn.id);
                            return (
                              <div
                                key={kn.id}
                                className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)] flex items-center justify-between gap-3 text-xs"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-7 h-7 rounded-md bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0">
                                    <Database className="w-3.5 h-3.5" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-medium text-[var(--md-sys-color-on-surface)] truncate">
                                      {isRTL ? kn.nameFa || kn.name : kn.name}
                                    </p>
                                    <p className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] truncate">
                                      {kn.sizeFormatted} · {kn.chunksCount} chunks
                                    </p>
                                  </div>
                                </div>
                                <M3Switch
                                  checked={isAttached}
                                  onChange={() => {
                                    setDraftKnowledgeIds((prev) =>
                                      isAttached ? prev.filter((id) => id !== kn.id) : [...prev, kn.id]
                                    );
                                  }}
                                  ariaLabel={`Attach ${kn.name}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Right Side: Smartphone Device Simulation Preview (Toggled from RIGHT TOP preview button!) */}
            {isSimPreviewVisible && (
              <section className="w-full lg:w-[38%] xl:w-[34%] border-t lg:border-t-0 lg:border-s border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] flex flex-col items-center justify-center p-3 md:p-6 overflow-y-auto animate-in fade-in duration-150">
                {/* Height follows the viewport so the device is never clipped */}
                <div className="w-full max-w-[min(340px,100%)] aspect-[9/19] max-h-full rounded-[32px] border-[7px] border-[var(--md-sys-color-outline)] bg-[var(--md-sys-color-surface-container-lowest)] relative flex flex-col overflow-hidden shadow-xl">
                  {/* Phone Top Notch */}
                  <div className="h-6 w-full bg-[var(--md-sys-color-surface-container-lowest)] flex items-center justify-between px-6 pt-1 shrink-0 z-20">
                    <span className="text-[11px] font-bold font-mono text-[var(--md-sys-color-on-surface)]">9:41</span>
                    <div className="w-16 h-3.5 bg-black rounded-full shrink-0 mx-auto -mt-0.5" />
                    <div className="flex items-center gap-1.5 text-[var(--md-sys-color-on-surface)]">
                      <Wifi className="w-3 h-3" />
                      <Battery className="w-3.5 h-3.5" />
                    </div>
                  </div>

                  {/* Mobile App Header */}
                  <div className="h-12 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3.5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0 text-[var(--md-sys-color-on-surface)]">
                        {renderBotIcon(currentBot)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xs font-semibold truncate text-[var(--md-sys-color-on-surface)] leading-tight">
                          {isRTL ? currentBot.nameFa || currentBot.name : currentBot.name}
                        </h3>
                        <div className="flex items-center gap-1 text-[9px] text-emerald-500 font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>{draftBotType === 'simple' ? 'Deterministic (0ms)' : t.mobileStatus}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={clearBotSimulation}
                        className="p-1 rounded-full text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container)]"
                        title={t.clearChat}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsSimPreviewVisible(false)}
                        className="p-1 rounded-full text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container)]"
                        title={t.hidePreview}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Mobile Chat Message Feed */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-[var(--md-sys-color-surface-container-lowest)]">
                    {botSimulationMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`p-2.5 rounded-xl max-w-[85%] text-xs leading-relaxed ${
                            msg.sender === 'user'
                              ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] rounded-br-xs font-medium'
                              : 'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)] rounded-bl-xs'
                          }`}
                          dir={isRTL ? 'rtl' : 'ltr'}
                        >
                          <div className="whitespace-pre-line">{msg.content}</div>
                          <span className="block text-[8px] opacity-70 text-end mt-1 font-mono">
                            {msg.timestamp || 'Now'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Mobile Bottom Input Bar */}
                  <div className="p-2 border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] shrink-0">
                    <form onSubmit={handleRunSimulation} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={simInput}
                        onChange={(e) => setSimInput(e.target.value)}
                        placeholder={draftBotType === 'simple' ? 'Type keyword (e.g. ping, help)...' : t.testPromptPlaceholder}
                        className="flex-1 px-3 py-1.5 rounded-full bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none"
                        dir={isRTL ? 'rtl' : 'ltr'}
                      />
                      <button
                        type="submit"
                        disabled={!simInput.trim()}
                        className="w-7 h-7 rounded-full bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] flex items-center justify-center shrink-0 hover:opacity-90 disabled:opacity-40 transition-opacity shadow-xs"
                        title={t.send}
                      >
                        <Send className={`w-3 h-3 ${isRTL ? 'rotate-180' : ''}`} />
                      </button>
                    </form>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
