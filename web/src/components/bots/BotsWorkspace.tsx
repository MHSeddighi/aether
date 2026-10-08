import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ArrowUp,
  Database,
  Wrench,
  Check,
  Copy,
  Code2,
  BarChart3,
  Sparkles,
  Bot,
  Plus,
  X,
  Search,
  SlidersHorizontal,
  Zap,
  Smile,
  Trash2,
  Paperclip,
  FileText,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  History,
} from 'lucide-react';
import { BotItem, BotType, RunRecord, RunStatus } from '../../types/agent';
import { M3Switch } from '../ui/M3Switch';
import { TechLoadingAnimation } from '../ui/TechLoadingAnimation';
import { runsApi } from '../../lib/api';

const EMOJI_CATEGORIES = [
  { id: 'robots', label: 'AI & Tech', emojis: ['🤖', '⚡', '🧠', '🔬', '🛸', '🛰️', '💻', '⚙️', '🔋', '📡', '👾', '🕹️'] },
  { id: 'roles', label: 'Work & Tasks', emojis: ['💼', '📊', '📝', '🎯', '💡', '🔮', '🔒', '🔎', '📈', '📋', '📁', '🎓'] },
  { id: 'characters', label: 'Characters', emojis: ['🐱', '🦊', '🦉', '🐼', '🦁', '🦄', '🐶', '🐙', '🦖', '🐻', '🐰', '🐯'] },
  { id: 'symbols', label: 'Badges', emojis: ['💎', '🌟', '🚀', '🎨', '🛡️', '🌐', '💬', '🏆', '🔥', '✨', '⭐', '🏷️'] },
];

const ALL_BOT_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

/**
 * The bot routes resolve their bot in a loader and redirect when it is missing,
 * so `currentBot` is always a real bot on those pages. This placeholder only
 * exists to keep the component total (e.g. an empty catalog).
 */
const NO_BOT: BotItem = {
  id: '',
  name: '',
  description: '',
  avatarIcon: 'Bot',
  avatarBg: '',
  model: '',
  instructions: '',
  toolIds: [],
  knowledgeIds: [],
  variables: [],
  temperature: 0,
  status: 'draft',
  enabled: false,
  version: '0.0.0',
  versions: [],
  metrics: { totalRuns: 0, avgLatencyMs: 0, tokensConsumed: 0, successRatePercent: 0 },
  lastUsed: 'Never',
};

/**
 * The bot page has exactly two views, `overview` and `studio`, and they share one
 * header. Overview answers "what is this bot and how is it doing", Studio answers
 * "let me talk to it / change it". Nothing else belongs on either page.
 *
 * The view comes from the route, never from local state, so deep links, the
 * browser's back button and every in-app shortcut agree on what is on screen.
 */
type StudioTab = 'chat' | 'build' | 'configure';

const RUN_STATUS_STYLE: Record<RunStatus, string> = {
  queued: 'bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]',
  running: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  succeeded: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
  cancelled: 'bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]',
  timed_out: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

export const BotsWorkspace: React.FC<{ view: 'list' | 'overview' | 'studio' }> = ({ view }) => {
  const navigate = useNavigate();
  const { botId } = useParams({ strict: false }) as { botId?: string };
  const {
    bots,
    setSelectedBotId,
    selectedBot,
    editingBot,
    setEditingBot,
    saveBot,
    toggleBotEnabled,
    createSimpleBot,
    selectBot,
    testBotMessage,
    botSimulationMessages,
    clearBotSimulation,
    resetBotSimulation,
    agentRefineBot,
    agentEditMessages,
    clearAgentEditChat,
    isAgentEditing,
    tools,
    knowledge,
    t,
    isRTL,
  } = useWorkspace();

  // List view search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'agent' | 'simple' | 'active' | 'draft'>('all');

  // The router guarantees the bot exists before this renders, so the page always
  // has a subject; the catalog falls back to the whole list.
  const routedBot = botId ? bots.find((b) => b.id === botId) : undefined;
  const currentBot: BotItem = (view === 'list' ? bots[0] : routedBot) ?? NO_BOT;

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
      { trigger: 'ping', response: 'pong!' },
      { trigger: 'help', response: 'Available commands: ping, status, help' },
    ]
  );
  const [newTrigger, setNewTrigger] = useState('');
  const [newResponse, setNewResponse] = useState('');

  // Emoji Picker state
  const [emojiPickerTargetBotId, setEmojiPickerTargetBotId] = useState<string | null>(null);
  const [selectedEmojiCategory, setSelectedEmojiCategory] = useState<string>('robots');

  // Studio tabs & inputs
  const [studioTab, setStudioTab] = useState<StudioTab>('chat');
  const [simInput, setSimInput] = useState('');
  const [agentEditInput, setAgentEditInput] = useState('');
  const [agentAttachments, setAgentAttachments] = useState<{ name: string; sizeFormatted: string }[]>([]);
  const [codeLang, setCodeLang] = useState<'python' | 'typescript' | 'curl'>('python');
  const [isCodeOpen, setIsCodeOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Real, durable run history for the Overview page.
  const [botRuns, setBotRuns] = useState<RunRecord[]>([]);
  const [areRunsLoading, setAreRunsLoading] = useState(false);

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

  // Runs are only needed on the Overview view, so they are fetched there.
  useEffect(() => {
    if (view !== 'overview' || !currentBot?.id) return;
    let cancelled = false;
    setAreRunsLoading(true);
    runsApi
      .list({ botId: currentBot.id, limit: 10 })
      .then((records) => {
        if (!cancelled) setBotRuns(records);
      })
      .catch(() => {
        if (!cancelled) setBotRuns([]);
      })
      .finally(() => {
        if (!cancelled) setAreRunsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, currentBot?.id]);

  /**
   * Overview and Studio are two views of one page, so switching is always allowed
   * and always goes through the router — the URL stays the single source of truth.
   */
  const goToBot = useCallback(
    (bot: BotItem, target: 'overview' | 'studio') => {
      selectBot(bot.id);
      if (target === 'studio') {
        setStudioTab('chat');
        resetBotSimulation(bot);
      }
      void navigate({ to: `/bots/$botId/${target}`, params: { botId: bot.id } });
    },
    [navigate, resetBotSimulation, selectBot]
  );

  const goToList = () => void navigate({ to: '/bots' });

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
      setAgentAttachments((prev) => [...prev, { name: file.name, sizeFormatted: `${sizeMb} MB` }]);
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
        return `# Deterministic Bot Runner (no model, no token cost)
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
        return `// Deterministic TypeScript Rule Matcher
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
  },
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

  const isSimpleBot = currentBot?.botType === 'simple';
  const botDisplayName = isRTL ? currentBot?.nameFa || currentBot?.name : currentBot?.name;
  const integrationsCount = (currentBot?.toolIds.length ?? 0) + (currentBot?.knowledgeIds.length ?? 0);

  /** Shared header for Overview + Studio: identity, view switcher, status, primary action. */
  const renderBotHeader = (current: 'overview' | 'studio') => (
    <header
      className="h-14 shrink-0 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 md:px-6 flex items-center gap-2 md:gap-4"
      data-testid="bot-header"
    >
      {/* Back to the catalog */}
      <button
        type="button"
        onClick={goToList}
        className="h-9 px-2 rounded-lg hover:bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] font-medium flex items-center gap-1 transition-colors shrink-0"
        title={t.allBots}
      >
        {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        <span className="hidden lg:inline">{t.allBots}</span>
      </button>

      {/* Identity */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setEmojiPickerTargetBotId(currentBot.id)}
          className="w-8 h-8 rounded-lg bg-[var(--md-sys-color-surface-container-high)] hover:bg-[var(--md-sys-color-surface-container-highest)] flex items-center justify-center shrink-0 transition-colors"
          title={t.changeIcon}
        >
          {renderBotIcon(currentBot)}
        </button>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-[var(--md-sys-color-on-surface)] truncate max-w-[110px] md:max-w-[220px]">
            {botDisplayName}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] shrink-0">
            v{currentBot.version}
          </span>
        </div>
      </div>

      {/* View switcher — Overview and Studio are peers, so the switch is always visible. */}
      <div
        role="tablist"
        aria-label={isRTL ? 'نمای صفحه بات' : 'Bot page view'}
        className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] shrink-0"
      >
        {(['overview', 'studio'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={current === v}
            onClick={() => goToBot(currentBot, v)}
            className={`h-7 px-2.5 md:px-3 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1.5 ${
              current === v
                ? 'bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] shadow-xs'
                : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
            }`}
            data-testid={`bot-view-${v}`}
          >
            {v === 'overview' ? <BarChart3 className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{v === 'overview' ? t.viewOverview : t.viewStudio}</span>
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Status */}
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

      {/* One primary action per view: develop from Overview, persist from Studio. */}
      {current === 'overview' ? (
        <button
          type="button"
          onClick={() => goToBot(currentBot, 'studio')}
          className="h-9 px-3.5 rounded-lg bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] font-semibold text-xs flex items-center gap-1.5 hover:opacity-90 transition-opacity shrink-0"
          data-testid="open-studio"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{t.developBot}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSavePlaygroundConfig}
          className="h-9 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] font-semibold text-xs hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors flex items-center gap-1.5 shrink-0"
          data-testid="save-changes"
        >
          {saveSuccess ? <Check className="w-3.5 h-3.5" /> : null}
          <span>{saveSuccess ? t.applied : t.saveChanges}</span>
        </button>
      )}
    </header>
  );

  /** One reusable message list for both the Playground and the Build agent chat. */
  const renderMessageFeed = (
    messages: { id: string; sender: 'user' | 'bot'; content: string; isStreaming?: boolean }[],
    emptyLabel: string
  ) => (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3.5" data-testid="message-feed">
      {messages.length === 0 && (
        <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] text-center pt-6">{emptyLabel}</p>
      )}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-3 text-xs md:text-sm ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          data-testid={msg.sender === 'user' ? 'message-user' : 'message-bot'}
        >
          {msg.sender === 'bot' && (
            <div className="w-7 h-7 rounded-lg bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0 mt-0.5 text-[var(--md-sys-color-on-surface)]">
              <Bot className="w-4 h-4" />
            </div>
          )}
          <div
            data-testid="message-content"
            className={`p-3.5 rounded-xl max-w-xl leading-relaxed whitespace-pre-line ${
              msg.sender === 'user'
                ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] rounded-br-xs font-medium'
                : 'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)] rounded-bl-xs'
            }`}
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            {msg.content}
            {msg.isStreaming && msg.content === '' && (
              <TechLoadingAnimation variant="circular" size="sm" />
            )}
          </div>
        </div>
      ))}
    </div>
  );

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
         VIEW 1 — ALL BOTS CATALOG
         ========================================================================= */}
      {view === 'list' && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <header className="h-16 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 md:px-8 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5 text-[var(--md-sys-color-on-surface)]" />
              </div>
              <h1 className="text-sm md:text-base font-semibold text-[var(--md-sys-color-on-surface)] truncate">
                {t.botsTitle}
              </h1>
            </div>

            <button
              type="button"
              onClick={async () => {
                const created = await createSimpleBot();
                goToBot(created, 'studio');
              }}
              className="h-9 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] font-semibold text-xs flex items-center gap-1.5 hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors shrink-0"
              data-testid="create-simple-bot"
            >
              <Zap className="w-4 h-4" />
              <span>{isRTL ? 'ساخت بات ساده' : 'Create Simple Bot'}</span>
            </button>
          </header>

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

            <div className="flex items-center gap-4 w-full sm:w-auto overflow-x-auto no-scrollbar">
              {(
                [
                  ['all', t.filterAll],
                  ['simple', t.filterSimple],
                  ['agent', t.filterAgent],
                  ['active', t.filterActive],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`bot-filter-${id}`}
                  onClick={() => setStatusFilter(id)}
                  className={`flex-1 sm:flex-none py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    statusFilter === id
                      ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                      : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 md:gap-4">
                {filteredBots.map((bot) => (
                  <div
                    key={bot.id}
                    className="group w-full min-w-0 flex flex-col rounded-lg bg-[var(--md-sys-color-surface-container)] hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors overflow-hidden"
                    data-testid="bot-card"
                  >
                    {/* Identity row. A div, not a button: it contains the publish switch. */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => goToBot(bot, 'overview')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          goToBot(bot, 'overview');
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
                          ariaLabel={bot.enabled ? `${bot.name} — ${t.unpublishBot}` : `${bot.name} — ${t.publishBot}`}
                        />
                      </span>
                    </div>

                    <div className="px-3.5 pb-3.5 min-w-0">
                      <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] line-clamp-2 leading-relaxed break-words">
                        {isRTL ? bot.descriptionFa || bot.description : bot.description}
                      </p>
                    </div>

                    <div className="mt-auto flex items-center gap-1.5 px-3.5 py-2.5 border-t border-[var(--md-sys-color-outline-variant)]">
                      <button
                        type="button"
                        onClick={() => goToBot(bot, 'studio')}
                        className="h-8 px-3 rounded-lg bg-[var(--md-sys-color-surface-container-high)] hover:bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{t.openInStudio}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => goToBot(bot, 'overview')}
                        className="h-8 px-3 rounded-lg text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        <span>{t.botOverview}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
         VIEW 2 — OVERVIEW: one scroll, one job: what this bot is and how it is doing
         ========================================================================= */}
      {view === 'overview' && (
        <div className="flex-1 flex flex-col h-full overflow-hidden" data-testid="bot-overview">
          {renderBotHeader('overview')}

          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="max-w-4xl mx-auto space-y-4">
              {/* Summary */}
              <section className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-3">
                <p className="text-xs md:text-sm text-[var(--md-sys-color-on-surface)] leading-relaxed">
                  {isRTL
                    ? currentBot.descriptionFa || currentBot.description || t.noDescription
                    : currentBot.description || t.noDescription}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]">
                    {isSimpleBot ? (isRTL ? 'بات قطعی' : 'Deterministic') : (isRTL ? 'بات ایجنت' : 'Agent')}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]">
                    {isSimpleBot ? t.noModelDeterministic : currentBot.model}
                  </span>
                  {integrationsCount > 0 && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]">
                      {`${integrationsCount} ${t.integrations}`}
                    </span>
                  )}
                </div>
              </section>

              {/* Metrics — only what the workspace actually tracks */}
              <section className="space-y-2" data-testid="overview-metrics">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
                  {t.overviewMetrics}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                      {t.totalRuns}
                    </span>
                    <p className="text-2xl font-bold font-mono text-[var(--md-sys-color-on-surface)]">
                      {currentBot.metrics.totalRuns.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                      {t.successRate}
                    </span>
                    <p className="text-2xl font-bold font-mono text-emerald-500">
                      {currentBot.metrics.successRatePercent}%
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                      {t.tokensConsumed}
                    </span>
                    <p className="text-2xl font-bold font-mono text-[var(--md-sys-color-on-surface)]">
                      {currentBot.metrics.tokensConsumed.toLocaleString()}
                    </p>
                  </div>
                </div>
              </section>

              {/* Recent activity — real runs, straight from the API */}
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  {t.recentActivity}
                </h3>
                {areRunsLoading ? (
                  <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] p-3 rounded-lg bg-[var(--md-sys-color-surface-container-low)]">
                    …
                  </p>
                ) : botRuns.length === 0 ? (
                  <p
                    className="text-xs text-[var(--md-sys-color-on-surface-variant)] p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] text-center"
                    data-testid="no-runs"
                  >
                    {t.noRunsYet}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {botRuns.map((run) => (
                      <div
                        key={run.id}
                        className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-1.5"
                        data-testid="run-row"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
                            {run.status === 'succeeded' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 text-[var(--md-sys-color-on-surface-variant)]" />
                            )}
                            <span className="font-mono">v{run.botVersion}</span>
                            <span>·</span>
                            <span className="font-mono">{run.model?.label ?? run.model?.modelId}</span>
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-semibold ${RUN_STATUS_STYLE[run.status]}`}
                          >
                            {run.status}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--md-sys-color-on-surface)] line-clamp-1">
                          <span className="text-[var(--md-sys-color-on-surface-variant)] font-mono text-[10px] me-1.5">
                            {t.runInput}
                          </span>
                          {run.input}
                        </p>
                        {run.output && (
                          <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] line-clamp-1">
                            <span className="font-mono text-[10px] me-1.5">{t.runOutput}</span>
                            {run.output}
                          </p>
                        )}
                        {run.failure && (
                          <p className="text-[11px] text-red-500 line-clamp-1">{run.failure.message}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Version history */}
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
                  {t.versionHistory}
                </h3>
                <div className="space-y-2">
                  {currentBot.versions.map((v) => (
                    <div
                      key={v.version}
                      className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container-low)] flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">v{v.version}</span>
                          <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)]">{v.updatedAt}</span>
                        </div>
                        <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">{v.notes}</p>
                      </div>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)] shrink-0">
                        {v.model}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Get code — collapsed by default, it is a copy-out, not a reading task */}
              <section className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-3">
                <button
                  type="button"
                  onClick={() => setIsCodeOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 text-xs font-semibold text-[var(--md-sys-color-on-surface)]"
                  data-testid="toggle-code"
                >
                  <span className="flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5" />
                    {t.getCode}
                  </span>
                  <span className="text-[10px] font-normal text-[var(--md-sys-color-on-surface-variant)]">
                    {isCodeOpen ? '−' : '+'}
                  </span>
                </button>

                {isCodeOpen && (
                  <>
                    <div className="flex items-center justify-between gap-2">
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
                    <pre className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-lowest)] font-mono text-xs overflow-x-auto text-[var(--md-sys-color-on-surface)]">
                      {generateCodeSnippet(currentBot, codeLang)}
                    </pre>
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
         VIEW 3 — STUDIO: Playground | Build | Configure
         ========================================================================= */}
      {view === 'studio' && (
        <div className="flex-1 flex flex-col h-full overflow-hidden" data-testid="bot-studio">
          {renderBotHeader('studio')}

          {/* Studio navigation */}
          <nav
            className="h-11 shrink-0 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 md:px-6 flex items-center gap-4 overflow-x-auto no-scrollbar"
            aria-label={t.viewStudio}
          >
            {(
              [
                ['chat', <MessageSquare key="i" className="w-3.5 h-3.5" />, t.studioTabChat],
                ['build', <Sparkles key="i" className="w-3.5 h-3.5" />, t.build],
                ['configure', <SlidersHorizontal key="i" className="w-3.5 h-3.5" />, t.studioTabConfigure],
              ] as const
            ).map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={studioTab === id}
                onClick={() => setStudioTab(id)}
                className={`h-11 px-0 text-xs font-medium flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors ${
                  studioTab === id
                    ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-surface)] font-semibold'
                    : 'border-transparent text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                }`}
                data-testid={`studio-tab-${id}`}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="flex-1 flex flex-col overflow-hidden bg-[var(--md-sys-color-surface)]">
            {/* TAB 1 — PLAYGROUND: talk to the bot exactly as an end user would */}
            {studioTab === 'chat' && (
              <div className="flex-1 flex flex-col h-full overflow-hidden" data-testid="studio-playground">
                <p className="px-4 md:px-6 pt-3 text-[11px] text-[var(--md-sys-color-on-surface-variant)] shrink-0">
                  {t.playgroundHint}
                </p>

                {renderMessageFeed(botSimulationMessages, t.playgroundHint)}

                <div className="p-3 md:p-4 border-t border-[var(--md-sys-color-outline-variant)] shrink-0">
                  <form onSubmit={handleRunSimulation} className="mx-auto max-w-3xl">
                    <div className="rounded-2xl bg-[var(--md-sys-color-surface-container)] flex items-end gap-2 p-2">
                      <textarea
                        rows={1}
                        value={simInput}
                        onChange={(e) => {
                          setSimInput(e.target.value);
                          autoGrowAgent(e.target);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleRunSimulation(e);
                          }
                        }}
                        placeholder={isSimpleBot ? (isRTL ? 'کلمه کلیدی (مثلاً ping)...' : 'Type keyword (e.g. ping)...') : t.testPromptPlaceholder}
                        className="flex-1 px-2 py-2 bg-transparent text-xs text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] outline-none focus:outline-none focus-visible:outline-none resize-none leading-relaxed max-h-[200px] overflow-y-auto"
                        dir={isRTL ? 'rtl' : 'ltr'}
                        data-testid="playground-input"
                      />
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={clearBotSimulation}
                          className="w-8 h-8 rounded-lg text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors flex items-center justify-center"
                          title={t.clearChat}
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          type="submit"
                          disabled={!simInput.trim()}
                          className="w-8 h-8 rounded-lg bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center"
                          title={t.send}
                          data-testid="playground-send"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* TAB 2 — BUILD: architecture agent that refines the bot */}
            {studioTab === 'build' && (
              <div className="flex-1 flex flex-col h-full overflow-hidden" data-testid="studio-build">
                {renderMessageFeed(agentEditMessages, t.botBuildingPlaceholder)}

                {isAgentEditing && (
                  <div className="px-4 md:px-6 pb-2 flex items-center gap-2.5 text-xs text-[var(--md-sys-color-on-surface-variant)]">
                    <TechLoadingAnimation variant="circular" size="sm" />
                    <span>{isRTL ? 'در حال ساخت قوانین بات...' : 'Synthesizing bot rules and architecture...'}</span>
                  </div>
                )}

                <div className="p-3 md:p-4 border-t border-[var(--md-sys-color-outline-variant)] shrink-0">
                  <form onSubmit={handleAgentEditSubmit} className="mx-auto max-w-3xl">
                    <div className="rounded-2xl bg-[var(--md-sys-color-surface-container)]">
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
                          isSimpleBot
                            ? (isRTL
                                ? 'دستور جدید یا کلمه کلیدی را بنویسید (مثلاً: اضافه کردن قانون برای قیمت‌ها)...'
                                : 'Describe rules to add or refine (e.g. Add pricing trigger, return $99)...')
                            : t.botBuildingPlaceholder
                        }
                        className="w-full px-4 pt-3.5 pb-1 bg-transparent text-xs text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] outline-none focus:outline-none focus-visible:outline-none resize-none leading-relaxed max-h-[200px] overflow-y-auto"
                        dir={isRTL ? 'rtl' : 'ltr'}
                        data-testid="build-input"
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
                          data-testid="build-send"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* TAB 3 — CONFIGURE: only the settings the bot type actually uses */}
            {studioTab === 'configure' && (
              <div className="flex-1 overflow-y-auto p-4 md:p-6" data-testid="studio-configure">
                <div className="max-w-3xl mx-auto space-y-4">
                  {isSimpleBot ? (
                    <section className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-4">
                      <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--md-sys-color-outline-variant)]">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400">
                          <Zap className="w-4 h-4" />
                        </div>
                        <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                          {t.deterministicRules}
                        </h3>
                      </div>

                      <div className="p-3.5 rounded-lg bg-[var(--md-sys-color-surface-container)] space-y-3">
                        <span className="text-xs font-semibold text-[var(--md-sys-color-on-surface)] block">
                          {isRTL ? 'افزودن قانون جدید' : 'Add New Trigger Condition'}
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={newTrigger}
                            onChange={(e) => setNewTrigger(e.target.value)}
                            placeholder={isRTL ? 'کلمه کلیدی (مثلاً: ping)...' : 'Trigger keyword (e.g. ping)...'}
                            className="px-3 py-2 rounded-lg bg-[var(--md-sys-color-surface-container-highest)] text-xs text-[var(--md-sys-color-on-surface)] focus:outline-none"
                            data-testid="new-rule-trigger"
                          />
                          <input
                            type="text"
                            value={newResponse}
                            onChange={(e) => setNewResponse(e.target.value)}
                            placeholder={isRTL ? 'پاسخ قطعی (مثلاً: pong)...' : 'Instant response (e.g. pong!)...'}
                            className="px-3 py-2 rounded-lg bg-[var(--md-sys-color-surface-container-highest)] text-xs text-[var(--md-sys-color-on-surface)] focus:outline-none"
                            data-testid="new-rule-response"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleAddDeterministicRule}
                          disabled={!newTrigger.trim() || !newResponse.trim()}
                          className="h-8 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] text-xs font-semibold hover:bg-[var(--md-sys-color-surface-container-high)] disabled:opacity-40 transition-colors flex items-center gap-1.5"
                          data-testid="add-rule"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isRTL ? 'ثبت قانون' : 'Add Rule'}</span>
                        </button>
                      </div>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-[var(--md-sys-color-on-surface)] block">
                          {isRTL ? 'قوانین فعال بات' : 'Configured Rule Triggers'} ({draftDeterministicRules.length})
                        </span>
                        <div className="space-y-2" data-testid="rules-list">
                          {draftDeterministicRules.map((rule, idx) => (
                            <div
                              key={idx}
                              className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)] flex items-start justify-between gap-3 text-xs"
                            >
                              <div className="space-y-0.5 min-w-0">
                                <span className="text-[10px] font-mono font-semibold text-[var(--md-sys-color-primary)] block">
                                  {isRTL ? `اگر شامل «${rule.trigger}» باشد` : `IF input contains "${rule.trigger}"`}
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
                    </section>
                  ) : (
                    <>
                      <section className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-3">
                        <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                          {t.systemInstructions}
                        </h3>
                        <textarea
                          rows={4}
                          value={draftInstructions}
                          onChange={(e) => setDraftInstructions(e.target.value)}
                          placeholder="You are an expert AI assistant..."
                          className="w-full p-3 rounded-lg bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none leading-relaxed"
                          dir={isRTL ? 'rtl' : 'ltr'}
                          data-testid="instructions-input"
                        />
                      </section>

                      <section className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-4">
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
                      </section>

                      <section className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-3">
                        <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                          {t.tools} ({draftToolIds.length} connected)
                        </h3>
                        <div className="max-h-48 overflow-y-auto space-y-2 pe-1">
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
                                  onChange={() =>
                                    setDraftToolIds((prev) =>
                                      isAttached ? prev.filter((id) => id !== tl.id) : [...prev, tl.id]
                                    )
                                  }
                                  ariaLabel={`Attach ${tl.name}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </section>

                      <section className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container-low)] space-y-3">
                        <h3 className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                          {t.connectedKnowledge} ({draftKnowledgeIds.length} attached)
                        </h3>
                        <div className="max-h-48 overflow-y-auto space-y-2 pe-1">
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
                                  onChange={() =>
                                    setDraftKnowledgeIds((prev) =>
                                      isAttached ? prev.filter((id) => id !== kn.id) : [...prev, kn.id]
                                    )
                                  }
                                  ariaLabel={`Attach ${kn.name}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
