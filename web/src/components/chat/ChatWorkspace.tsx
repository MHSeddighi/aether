import React, { useState, useRef, useEffect } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  Send,
  StopCircle,
  Paperclip,
  RotateCcw,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  ChevronUp,
  X,
  FileText,
  Menu,
  Code2,
  ExternalLink,
  Wrench,
  Play,
  Bot,
  Eye,
  EyeOff,
  Smartphone,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { MagicalAgentIcon } from '../ui/MagicalAgentIcon';
import { TechLoadingAnimation } from '../ui/TechLoadingAnimation';
import { BotItem } from '../../types/agent';

export const ChatWorkspace: React.FC = () => {
  const {
    activeConversation,
    sendMessage,
    isStreaming,
    stopStreaming,
    regenerateLastMessage,
    setMessageFeedback,
    bots,
    selectedBotId,
    setSelectedBotId,
    selectedBot,
    knowledge,
    setIsMobileDrawerOpen,
    chatMode,
    setChatMode,
    agentMode,
    setAgentMode,
    confirmAndDeployBot,
    saveToolToWorkspace,
    createAndOpenSimpleBot,
    editingBotInChat,
    openBotInStudio,
    t,
    isRTL,
  } = useWorkspace();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<{ name: string; sizeFormatted: string; type: string }[]>([]);
  const [isBotPickerOpen, setIsBotPickerOpen] = useState(false);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedThoughtId, setExpandedThoughtId] = useState<Record<string, boolean>>({});
  const [expandedCodeId, setExpandedCodeId] = useState<Record<string, boolean>>({});
  const [previewingBotId, setPreviewingBotId] = useState<string | null>(null);
  const [previewSimInput, setPreviewSimInput] = useState('');
  const [previewSimMessages, setPreviewSimMessages] = useState<Record<string, { id: string; sender: 'user' | 'bot'; content: string }[]>>({});
  const [disabledModeToast, setDisabledModeToast] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isNewChat = !activeConversation || activeConversation.messages.length === 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages, isStreaming]);

  const handleSend = () => {
    if (!input.trim() && attachments.length === 0) return;
    if (isNewChat && agentMode === 'simple-bot') {
      // Directly create and transition into the simple bot's studio playground!
      createAndOpenSimpleBot(input);
      setInput('');
      setAttachments([]);
      return;
    }
    sendMessage(input, attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
    setIsBotPickerOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const MODES = [
    {
      id: 'simple-bot' as const,
      label: t.simpleBotTitle,
      hint: isRTL ? '۰ میلی‌ثانیه · بدون مدل' : '0ms · no model',
      enabled: true,
      icon: <Zap className="w-3.5 h-3.5" />,
    },
    {
      id: 'agent-bot' as const,
      label: isRTL ? 'بات ایجنت (LLM)' : 'Agent Bot (LLM)',
      hint: isRTL ? 'به‌زودی' : 'Coming soon',
      enabled: false,
      icon: <Bot className="w-3.5 h-3.5" />,
    },
    {
      id: 'tool-building' as const,
      label: isRTL ? 'ساخت ابزار' : 'Tool Building',
      hint: isRTL ? 'به‌زودی' : 'Coming soon',
      enabled: false,
      icon: <Wrench className="w-3.5 h-3.5" />,
    },
  ];

  const activeMode = MODES.find((m) => m.id === agentMode) || MODES[0];

  const handleModeClick = (mode: 'simple-bot' | 'agent-bot' | 'tool-building') => {
    setIsModeMenuOpen(false);
    if (mode === 'tool-building') {
      setDisabledModeToast(
        isRTL
          ? 'حالت ساخت ابزار (Tool Building) در حال حاضر غیرفعال است و به زودی فعال خواهد شد.'
          : 'Tool Building mode is currently disabled and coming soon.'
      );
      setTimeout(() => setDisabledModeToast(null), 3000);
      return;
    }
    if (mode === 'agent-bot') {
      setDisabledModeToast(
        isRTL
          ? 'حالت بات ایجنت (LLM + Tools) به دلیل نیاز به سهمیه مدل‌های زبانی غیرفعال است. بات استاتیک ساده فعال می‌باشد.'
          : 'Agent Bot mode is currently disabled (requires external LLM quota). Simple Static Bot is enabled.'
      );
      setTimeout(() => setDisabledModeToast(null), 3000);
      return;
    }
    setAgentMode('simple-bot');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Composer grows with the query, up to a cap, then scrolls internally.
  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const composerShell = 'w-full rounded-2xl bg-[var(--md-sys-color-surface-container)]';

  // Put text into the composer from anywhere (chips, refine action) and keep
  // the growing height in sync.
  const fillComposer = (value: string) => {
    setInput(value);
    requestAnimationFrame(() => {
      autoGrow(textareaRef.current);
      textareaRef.current?.focus();
    });
  };

  const renderComposer = (variant: 'home' | 'chat') => (
    <div className={`${composerShell} relative`}>
      {/* LINE 1 — query */}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          autoGrow(e.target);
        }}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={
          variant === 'home'
            ? isRTL
              ? 'قوانین و کلمات کلیدی بات ساده را بنویسید (مثلاً ping -> pong)...'
              : 'Describe simple static bot triggers (e.g. ping -> pong, status -> OK)...'
            : agentMode === 'simple-bot'
            ? isRTL
              ? 'دستور یا کلمه کلیدی را وارد کنید...'
              : 'Type keyword or trigger for simple bot...'
            : t.botBuildingPlaceholder
        }
        className="w-full px-4 pt-3.5 pb-1 bg-transparent text-sm text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] outline-none focus:outline-none focus-visible:outline-none resize-none leading-relaxed max-h-[200px] overflow-y-auto"
        dir={isRTL ? 'rtl' : 'ltr'}
      />

      {/* Attachments live inside the composer, between the two lines */}
      {attachments.length > 0 && (
        <div className="px-4 pt-1 flex flex-wrap gap-1.5">
          {attachments.map((att, idx) => (
            <span
              key={idx}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--md-sys-color-surface-container-high)] text-[11px] text-[var(--md-sys-color-on-surface)]"
            >
              <FileText className="w-3 h-3 text-[var(--md-sys-color-on-surface-variant)]" />
              <span className="truncate max-w-[150px]">{att.name}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                className="text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]"
                title={t.clearChat}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* LINE 2 — icon-only actions */}
      <div className="flex items-center justify-between gap-1 px-2.5 py-2">
        <div className="flex items-center gap-0.5 min-w-0">
          {/* Mode selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsModeMenuOpen((v) => !v)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                isModeMenuOpen
                  ? 'bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)]'
                  : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
              }`}
              aria-haspopup="listbox"
              aria-expanded={isModeMenuOpen}
              title={activeMode.label}
            >
              {activeMode.icon}
            </button>

            {isModeMenuOpen && (
              <div
                role="listbox"
                className="absolute bottom-full start-0 mb-2 w-56 rounded-xl bg-[var(--md-sys-color-surface-container-high)] shadow-xl p-1 z-[60] animate-in fade-in zoom-in-95 duration-150"
              >
                {MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    role="option"
                    aria-selected={mode.id === activeMode.id}
                    onClick={() => handleModeClick(mode.id)}
                    className={`w-full px-2 py-1.5 rounded-md text-start flex items-center gap-2 transition-colors ${
                      mode.id === activeMode.id
                        ? 'bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)]'
                        : 'text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container)] hover:text-[var(--md-sys-color-on-surface)]'
                    }`}
                  >
                    <span className="shrink-0">{mode.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium truncate">{mode.label}</span>
                      <span className="block text-[10px] opacity-70 truncate">{mode.hint}</span>
                    </span>
                    {mode.id === activeMode.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* File attachment */}
          <label
            className="w-8 h-8 rounded-lg cursor-pointer text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors flex items-center justify-center"
            title={t.attachFiles}
          >
            <Paperclip className="w-4 h-4" />
            <input type="file" className="hidden" onChange={handleFileAttach} />
          </label>

          {/* Active bot shortcut, only in an active conversation */}
          {variant === 'chat' && chatMode === 'chat' && (
            <button
              type="button"
              onClick={() => openBotInStudio(selectedBot, 'playground')}
              className="w-8 h-8 rounded-lg text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors flex items-center justify-center"
              title={isRTL ? selectedBot.nameFa || selectedBot.name : selectedBot.name}
            >
              <MagicalAgentIcon size={15} glow={false} />
            </button>
          )}
        </div>

        {/* Submit */}
        {isStreaming ? (
          <button
            type="button"
            onClick={stopStreaming}
            className="w-8 h-8 rounded-lg bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-error)] hover:opacity-90 transition-opacity flex items-center justify-center shrink-0"
            title={t.stop}
          >
            <StopCircle className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() && attachments.length === 0}
            className="w-8 h-8 rounded-lg bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center shrink-0"
            title={t.send}
          >
            <Send className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setAttachments((prev) => [
        ...prev,
        {
          name: file.name,
          sizeFormatted: `${sizeMb} MB`,
          type: file.type || 'document',
        },
      ]);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const toggleThought = (msgId: string) => {
    setExpandedThoughtId((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  const toggleCodeBlock = (msgId: string) => {
    setExpandedCodeId((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  // Prompts for Standard Chat vs Bot Generation Agent
  const standardPrompts = [
    {
      label: t.suggAnalyzeDoc,
      prompt: isRTL
        ? 'لطفاً آخرین گزارش آماری و وضعیت کاربران را بررسی و نکات کلیدی آن را استخراج کن.'
        : 'Analyze our latest customer sales cohort document and identify retention drop-offs.',
    },
    {
      label: t.suggResearchTopic,
      prompt: isRTL
        ? 'بهترین روش‌های تقسیم‌بندی اسناد (Chunking) در مدل‌های بازیابی دانش را بررسی و مقایسه کن.'
        : 'Research the most effective chunking strategies for Retrieval-Augmented Generation.',
    },
    {
      label: t.suggCreateReport,
      prompt: isRTL
        ? 'یک گزارش ساختاریافته از معماری سیستم هوش مصنوعی و جریان داده‌ها تهیه کن.'
        : 'Create an executive summary report for the engineering team on architecture RFCs.',
    },
    {
      label: t.suggAnalyzeData,
      prompt: isRTL
        ? 'داده‌های تلمتری و عملکرد پایگاه داده را برای شناسایی هرگونه گلوگاه بررسی کن.'
        : 'Analyze telemetry metrics to flag any potential memory leaks or SQL anomalies.',
    },
  ];

  const botGenerationPrompts = [
    {
      label: isRTL ? 'بات پشتیبانی مشتریان با قوانین بازگشت کالا' : 'Customer Support agent for refunds',
      prompt: isRTL
        ? 'یک بات پشتیبانی مشتریان برای فروشگاه آنلاین بساز که قوانین بازگشت وجه تا ۷ روز را بررسی کرده و لحنی محترمانه و صبور داشته باشد.'
        : 'Build a customer support bot for an online store that handles refund requests within a 7-day policy with a helpful, empathetic tone.',
    },
    {
      label: isRTL ? 'تحلیل‌گر مالی و داده با پایگاه SQL' : 'Financial analyst bot with SQL access',
      prompt: isRTL
        ? 'یک بات تحلیل‌گر مالی بساز که بتواند کوئری‌های SQL بخواند، انحرافات سود را محاسبه کند و خروجی را با نمودار توضیح دهد.'
        : 'Create a financial analyst bot that can query SQL databases, detect revenue variance anomalies, and format executive summaries.',
    },
    {
      label: isRTL ? 'بازبین کد پایتون با بررسی Type Safety' : 'Python code auditor with strict typing',
      prompt: isRTL
        ? 'یک دستیار مهندسی نرم‌افزار بساز که کدهای پایتون را از نظر Type Hinting، حافظه و الگوهای async ارزیابی کند.'
        : 'Create a Python code reviewer agent that inspects pull requests for type hints, memory leaks, and asynchronous concurrency bugs.',
    },
    {
      label: isRTL ? 'دستیار پژوهشی با استناد به مقالات' : 'Research bot with grounded citations',
      prompt: isRTL
        ? 'یک بات پژوهشگر دانشگاهی طراحی کن که به منابع متصل استناد دقیق داده و هرگونه ادعا را با شماره صفحه مستند کند.'
        : 'Design an academic research agent that retrieves grounded citations from connected PDF papers with strict verification.',
    },
  ];

  const toolBuildingPrompts = [
    {
      label: isRTL ? 'ابزار استعلام قیمت لحظه‌ای ارز و سهام' : 'Financial real-time ticker webhook',
      prompt: isRTL
        ? 'یک ابزار اختصاصی برای دریافت نرخ لحظه‌ای طلا و ارز با متد GET و اعتبارسنجی پاسخ طراحی کن.'
        : 'Build an external tool to fetch real-time financial market tickers via HTTP webhook.',
    },
    {
      label: isRTL ? 'کانکتور سرور محلی با پروتکل MCP' : 'Local MCP filesystem connector',
      prompt: isRTL
        ? 'یک ابزار اتصال سرور Model Context Protocol برای خواندن فایل‌های پروژه بنویس.'
        : 'Design a Model Context Protocol (MCP) server tool to inspect local workspace repositories.',
    },
    {
      label: isRTL ? 'ابزار اجرای کدهای پایتون در Sandbox' : 'Sandboxed Python code runner',
      prompt: isRTL
        ? 'یک ابزار اجرای امن کدهای پایتون در محیط ایزوله طراحی کن.'
        : 'Create a sandboxed Python execution tool that accepts scripts and returns stdout.',
    },
    {
      label: isRTL ? 'وب‌هوک اتصال به ترلو و جیرا' : 'Jira & Trello issue creator webhook',
      prompt: isRTL
        ? 'ابزاری برای ایجاد تیکت و ثبت ایشیو در گیت‌هاب یا ترلو با اعتبارسنجی توکن بساز.'
        : 'Build a webhook integration tool to dispatch bug tickets to issue trackers.',
    },
  ];

  const activeSuggestedPrompts =
    agentMode === 'simple-bot'
      ? [
          { label: isRTL ? 'پاسخ فوری به پینگ و وضعیت' : 'Health & Ping responder', prompt: isRTL ? 'یک بات ساده برای بررسی وضعیت سرور و ارسال پاسخ فوری بساز.' : 'Build a simple deterministic bot that replies to ping and status checks.' },
          { label: isRTL ? 'هدایت‌گر کلمات کلیدی پشتیبانی' : 'Keyword routing rules', prompt: isRTL ? 'یک بات قطعی برای پاسخ سریع به کلمات کلیدی قیمت، پشتیبانی و ثبت نام طراحی کن.' : 'Create deterministic keyword response triggers for pricing, hours, and help.' },
        ]
      : botGenerationPrompts;

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] select-none">
      {/* Click-outside backdrop dismissal for popovers */}
      {(isBotPickerOpen || isModeMenuOpen) && (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={() => {
            setIsBotPickerOpen(false);
            setIsModeMenuOpen(false);
          }}
        />
      )}

      {/* Top Banner (Header Navbar): Hidden on Home page (new chat), visible only in active conversation */}
      {!isNewChat && (
        <header className="h-12 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 flex items-center justify-between gap-2 shrink-0 relative z-20 overflow-x-auto no-scrollbar flex-nowrap whitespace-nowrap">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileDrawerOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container)]"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Active Bot Context Chip */}
            <div className="flex items-center gap-2 text-xs text-[var(--md-sys-color-on-surface-variant)]">
              <span>{t.editingBotBanner}:</span>
              <button
                type="button"
                onClick={() => openBotInStudio(selectedBot, 'playground')}
                className="font-semibold text-[var(--md-sys-color-on-surface)] hover:underline flex items-center gap-1"
                title="Jump to Studio Playground"
              >
                <span>{isRTL ? selectedBot.nameFa || selectedBot.name : selectedBot.name}</span>
                <ExternalLink className="w-3 h-3 text-[var(--md-sys-color-on-surface-variant)]" />
              </button>
            </div>
          </div>

          {/* Right shortcut: Open Studio */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openBotInStudio(selectedBot, 'playground')}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-xs text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors"
            >
              <Play className="w-3 h-3" />
              <span>{t.backToPlayground}</span>
            </button>
          </div>
        </header>
      )}

      {/* Mobile Drawer Trigger when header navbar is hidden on home page */}
      {isNewChat && (
        <div className="md:hidden absolute top-3 start-3 z-30">
          <button
            type="button"
            onClick={() => setIsMobileDrawerOpen(true)}
            className="p-2 rounded-lg bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)]"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Main Conversation Viewport */}
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 relative z-10">
        {isNewChat ? (
          /* ========================================================
             NEW CHAT = HOME SCREEN (Google AI Studio Model)
             ======================================================== */
          <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto space-y-4 animate-in fade-in duration-300">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-[var(--md-sys-color-on-surface)] text-center">
              {chatMode === 'bot-generation' ? t.botGenerationHero : t.heroTitle}
            </h1>

            {/* Disabled Mode Warning Toast */}
            {disabledModeToast && (
              <div className="w-full max-w-xl p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center justify-between gap-2 animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{disabledModeToast}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDisabledModeToast(null)}
                  className="p-1 hover:bg-amber-500/20 rounded-md"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}


            {/* Self-contained composer: query on line 1, icon actions on line 2 */}
            <div className="w-full relative z-30">{renderComposer('home')}</div>

            {/* Suggested Prompts List */}
            <div className="w-full space-y-2 pt-2">
              <span className="text-xs text-[var(--md-sys-color-on-surface-variant)] font-medium">
                {t.suggestedPrompts}
              </span>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {activeSuggestedPrompts.map((sugg, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      fillComposer(sugg.prompt);
                    }}
                    className="px-3.5 py-1.5 rounded-full text-xs bg-[var(--md-sys-color-surface-container)] hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] transition-colors"
                  >
                    {sugg.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================
             ACTIVE CONVERSATION STREAM (With Google AI Studio Bot Blueprint Cards)
             ======================================================== */
          <div className="max-w-3xl mx-auto space-y-6 pb-32 animate-in fade-in duration-200">
            {activeConversation.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {/* Assistant Emblem */}
                {msg.sender === 'bot' && (
                  <div className="w-8 h-8 rounded-2xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center shrink-0 shadow-2xs mt-1 text-[var(--md-sys-color-on-surface)]">
                    <MagicalAgentIcon size={18} glow={false} isThinking={msg.isStreaming} />
                  </div>
                )}

                <div
                  className={`space-y-3 rounded-2xl p-4 md:p-5 text-xs md:text-sm leading-relaxed max-w-2xl ${
                    msg.sender === 'user'
                      ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] rounded-br-xs font-medium'
                      : 'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)] border border-[var(--md-sys-color-outline-variant)] rounded-bl-xs'
                  }`}
                  dir={isRTL ? 'rtl' : 'ltr'}
                >
                  {/* Header */}
                  {msg.sender === 'bot' && (
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--md-sys-color-outline-variant)] text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--md-sys-color-on-surface)]">
                          {chatMode === 'bot-generation' ? 'Bot Builder Agent' : (isRTL ? selectedBot.nameFa || selectedBot.name : selectedBot.name)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-md bg-[var(--md-sys-color-surface-container-high)] font-mono text-[10px]">
                          {selectedBot.model}
                        </span>
                      </div>
                      <span className="font-mono text-[10px]">{msg.timestamp}</span>
                    </div>
                  )}

                  {/* Message Content */}
                  {msg.content ? (
                    <div className="space-y-3">
                      <div className="whitespace-pre-line leading-relaxed font-normal">
                        {msg.content}
                      </div>

                      {/* =========================================================
                          REQUIREMENT 3: GENERATED / MOCKED BOT PROPOSAL ARTIFACT
                          (Google AI Studio blueprint card with preview, code & deploy)
                          ========================================================= */}
                      {msg.botProposal && (
                        <div className="mt-3 p-4 rounded-2xl bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline)] space-y-3 shadow-xs">
                          {/* Proposal Header */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center shrink-0">
                                <Bot className="w-5 h-5 text-[var(--md-sys-color-on-surface)]" />
                              </div>
                              <div>
                                <h4 className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                                  {msg.botProposal.proposedBot.name}
                                </h4>
                                <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--md-sys-color-on-surface-variant)] mt-0.5">
                                  <span>{msg.botProposal.proposedBot.model}</span>
                                  <span>·</span>
                                  <span>T={msg.botProposal.proposedBot.temperature}</span>
                                </div>
                              </div>
                            </div>

                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]">
                              Draft Ready
                            </span>
                          </div>

                          {/* Instructions Preview */}
                          <div className="p-3 rounded-xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] text-xs font-mono space-y-1">
                            <span className="text-[10px] uppercase font-semibold text-[var(--md-sys-color-on-surface-variant)] block">
                              System Instructions Preview:
                            </span>
                            <p className="text-[11px] leading-relaxed line-clamp-3 text-[var(--md-sys-color-on-surface)]">
                              {msg.botProposal.proposedBot.instructions}
                            </p>
                          </div>

                          {/* Code Preview Accordion */}
                          {msg.botProposal.codeSnippet && (
                            <div className="space-y-1.5">
                              <button
                                type="button"
                                onClick={() => toggleCodeBlock(msg.id)}
                                className="text-xs text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] flex items-center gap-1 font-mono"
                              >
                                <Code2 className="w-3.5 h-3.5" />
                                <span>{expandedCodeId[msg.id] ? 'Hide Python Code' : 'View Implementation Code (Google AI Studio)'}</span>
                              </button>

                              {expandedCodeId[msg.id] && (
                                <pre className="p-3 rounded-xl bg-[var(--md-sys-color-surface-container-lowest)] text-[11px] font-mono overflow-x-auto text-[var(--md-sys-color-on-surface)] border border-[var(--md-sys-color-outline-variant)]">
                                  {msg.botProposal.codeSnippet}
                                </pre>
                              )}
                            </div>
                          )}

                          {/* Confirmation & Deployment Actions */}
                          <div className="pt-2 border-t border-[var(--md-sys-color-outline-variant)] flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  fillComposer(`Refine ${msg.botProposal?.proposedBot.name}: `);
                                }}
                                className="px-3 py-1.5 rounded-xl bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] text-xs font-medium hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors"
                              >
                                {t.refineWithAgent}
                              </button>

                              {/* Requirement: Preview button to test simulation without having to open playground */}
                              <button
                                type="button"
                                onClick={() => {
                                  setPreviewingBotId((prev) => (prev === msg.id ? null : msg.id));
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                                  previewingBotId === msg.id
                                    ? 'bg-[var(--md-sys-color-secondary-container)] border-[var(--md-sys-color-secondary)] text-[var(--md-sys-color-on-secondary-container)] font-semibold'
                                    : 'bg-[var(--md-sys-color-surface-container)] border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                                }`}
                              >
                                {previewingBotId === msg.id ? (
                                  <>
                                    <EyeOff className="w-3.5 h-3.5" />
                                    <span>{t.hidePreview}</span>
                                  </>
                                ) : (
                                  <>
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>{t.preview}</span>
                                  </>
                                )}
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                if (msg.botProposal) {
                                  confirmAndDeployBot(msg.botProposal.proposedBot);
                                }
                              }}
                              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>{t.confirmDeploy}</span>
                            </button>
                          </div>

                          {/* Simulation Preview Drawer/Card when user clicks "Preview" */}
                          {previewingBotId === msg.id && (
                            <div className="mt-3 p-3.5 rounded-2xl bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] space-y-3 animate-in fade-in zoom-in-98 duration-150">
                              <div className="flex items-center justify-between pb-2 border-b border-[var(--md-sys-color-outline-variant)]">
                                <div className="flex items-center gap-2">
                                  <Smartphone className="w-4 h-4 text-[var(--md-sys-color-primary)]" />
                                  <span className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                                    {t.mobileSimulator} · {msg.botProposal.proposedBot.name}
                                  </span>
                                </div>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                  Live Sandbox
                                </span>
                              </div>

                              {/* Preview Messages Stream */}
                              <div className="max-h-52 overflow-y-auto space-y-2 p-1">
                                {(previewSimMessages[msg.id] || [
                                  {
                                    id: 'sim-intro',
                                    sender: 'bot',
                                    content: isRTL
                                      ? `سلام! من دستیار ${msg.botProposal.proposedBot.name} هستم. آماده برای تست!`
                                      : `Hello! I'm ${msg.botProposal.proposedBot.name}. Ask me anything to test my behavior.`,
                                  },
                                ]).map((simMsg) => (
                                  <div
                                    key={simMsg.id}
                                    className={`flex ${simMsg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                                  >
                                    <div
                                      className={`p-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed ${
                                        simMsg.sender === 'user'
                                          ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] rounded-br-xs font-medium'
                                          : 'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)] border border-[var(--md-sys-color-outline-variant)] rounded-bl-xs'
                                      }`}
                                    >
                                      {simMsg.content}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Preview Input form */}
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  if (!previewSimInput.trim()) return;
                                  const text = previewSimInput;
                                  setPreviewSimInput('');
                                  const userEntry = { id: `u-${Date.now()}`, sender: 'user' as const, content: text };
                                  setPreviewSimMessages((prev) => ({
                                    ...prev,
                                    [msg.id]: [...(prev[msg.id] || [{ id: 'intro', sender: 'bot', content: 'Ready' }]), userEntry],
                                  }));
                                  setTimeout(() => {
                                    const botEntry = {
                                      id: `b-${Date.now()}`,
                                      sender: 'bot' as const,
                                      content: `[Simulation: ${msg.botProposal?.proposedBot.model}]\nProcessed "${text}" using system instructions and parameters.`,
                                    };
                                    setPreviewSimMessages((prev) => ({
                                      ...prev,
                                      [msg.id]: [...(prev[msg.id] || []), botEntry],
                                    }));
                                  }, 500);
                                }}
                                className="flex items-center gap-1.5 pt-1"
                              >
                                <input
                                  type="text"
                                  value={previewSimInput}
                                  onChange={(e) => setPreviewSimInput(e.target.value)}
                                  placeholder={t.testPromptPlaceholder}
                                  className="flex-1 px-3 py-1.5 rounded-xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] text-xs text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none"
                                />
                                <button
                                  type="submit"
                                  disabled={!previewSimInput.trim()}
                                  className="px-3 py-1.5 rounded-xl bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] text-xs font-semibold hover:opacity-90 disabled:opacity-40"
                                >
                                  {t.send}
                                </button>
                              </form>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tool Proposal Blueprint Card */}
                      {msg.toolProposal && (
                        <div className="mt-3 p-4 rounded-2xl bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline)] space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="w-9 h-9 rounded-xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center">
                                <Wrench className="w-5 h-5 text-[var(--md-sys-color-on-surface)]" />
                              </div>
                              <div>
                                <h4 className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                                  {msg.toolProposal.proposedTool.name}
                                </h4>
                                <span className="text-[10px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
                                  Category: {msg.toolProposal.proposedTool.category} · Ready
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/15 text-amber-500 border border-amber-500/30 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{t.inDevelopment}</span>
                              </span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]">
                                Tool Blueprint
                              </span>
                            </div>
                          </div>

                          {/* Development notice for tool playground */}
                          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{t.toolInDevDesc}</span>
                          </div>

                          <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] leading-relaxed">
                            {msg.toolProposal.proposedTool.purpose}
                          </p>

                          {msg.toolProposal.codeSnippet && (
                            <pre className="p-3 rounded-xl bg-[var(--md-sys-color-surface-container-lowest)] text-[11px] font-mono overflow-x-auto text-[var(--md-sys-color-on-surface)] border border-[var(--md-sys-color-outline-variant)]">
                              {msg.toolProposal.codeSnippet}
                            </pre>
                          )}

                          <div className="pt-2 border-t border-[var(--md-sys-color-outline-variant)] flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                if (msg.toolProposal) {
                                  saveToolToWorkspace(msg.toolProposal.proposedTool);
                                }
                              }}
                              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{t.saveToolToWorkspace}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    msg.isStreaming && (
                      <div className="py-2.5">
                        <TechLoadingAnimation variant="circular" size="sm" label={t.streaming} />
                      </div>
                    )
                  )}

                  {/* Actions Bar */}
                  {msg.sender === 'bot' && !msg.isStreaming && (
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--md-sys-color-outline-variant)] text-xs text-[var(--md-sys-color-on-surface-variant)]">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--md-sys-color-surface-container-high)] hover:text-[var(--md-sys-color-on-surface)] transition-colors text-[11px]"
                          title={t.copy}
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="text-emerald-500 font-medium">{t.copied}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>{t.copy}</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={regenerateLastMessage}
                          className="p-1.5 rounded-lg hover:bg-[var(--md-sys-color-surface-container-high)] hover:text-[var(--md-sys-color-on-surface)] transition-colors"
                          title={t.regenerate}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setMessageFeedback(msg.id, 'good')}
                          className={`p-1.5 rounded-lg hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors ${
                            msg.feedback === 'good' ? 'text-[var(--md-sys-color-primary)] font-bold' : ''
                          }`}
                          title={t.goodResponse}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setMessageFeedback(msg.id, 'bad')}
                          className={`p-1.5 rounded-lg hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors ${
                            msg.feedback === 'bad' ? 'text-[var(--md-sys-color-error)]' : ''
                          }`}
                          title={t.badResponse}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Persistent Bottom Floating Composer (When in Active Chat) */}
      {!isNewChat && (
        <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-[var(--md-sys-color-surface)] via-[var(--md-sys-color-surface)]/95 to-transparent z-30">
          <div className="max-w-3xl mx-auto relative">{renderComposer('chat')}</div>
        </div>
      )}
    </div>
  );
};
