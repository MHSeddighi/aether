export type SupportedLocale = 'en' | 'fa';

export interface Translations {
  // Navigation
  workspace: string;
  newChat: string;
  bots: string;
  tools: string;
  knowledge: string;
  history: string;
  today: string;
  yesterday: string;
  previous7Days: string;
  older: string;
  settings: string;
  profile: string;
  usage: string;
  account: string;
  search: string;
  searchPlaceholder: string;
  collapseSidebar: string;
  expandSidebar: string;

  // New Chat (Home)
  heroTitle: string;
  heroSubtitle: string;
  askAnything: string;
  attachFiles: string;
  selectKnowledge: string;
  selectBot: string;
  send: string;
  stop: string;
  suggestedPrompts: string;
  suggAnalyzeDoc: string;
  suggResearchTopic: string;
  suggCreateReport: string;
  suggAnalyzeData: string;

  // Three Creation Modes (Tool Building, Agent Bot, Simple Static Bot)
  botBuildingMode: string;
  toolBuildingMode: string;
  toolBuildingDesc: string;
  agentBotTitle: string;
  agentBotDesc: string;
  simpleBotTitle: string;
  simpleBotDesc: string;
  disabledComingSoon: string;
  enabledActive: string;
  botOverview: string;
  developBot: string;
  backToOverview: string;
  changeIcon: string;
  selectEmoji: string;
  deterministic: string;
  deterministicRules: string;
  botBuildingPlaceholder: string;
  toolBuildingPlaceholder: string;
  proposedBotTitle: string;
  proposedToolTitle: string;
  confirmDeploy: string;
  saveToolToWorkspace: string;
  refineWithAgent: string;
  editingBotBanner: string;
  backToPlayground: string;

  // Google AI Studio Style Workspace
  studioPlayground: string;
  overviewMetrics: string;
  getCode: string;
  billingAndUsage: string;
  systemInstructions: string;
  modelParameters: string;
  tune: string;
  build: string;
  allBots: string;
  backToBots: string;
  businessLogic: string;
  mcpServers: string;
  mcpDesc: string;
  modelsAndHyperparameters: string;
  filterAll: string;
  filterActive: string;
  filterDraft: string;
  openInStudio: string;
  moreActions: string;
  agentEditTitle: string;
  agentEditSubtitle: string;
  agentEditPlaceholder: string;
  applyChanges: string;
  runSimulation: string;
  clearChat: string;
  testPromptPlaceholder: string;
  version: string;
  totalRuns: string;
  avgLatency: string;
  tokensConsumed: string;
  successRate: string;
  versionHistory: string;
  conversationsHistory: string;
  pythonSdk: string;
  typeScriptSdk: string;
  restCurl: string;
  copyCode: string;

  // Billing & Usage in Playground
  estimatedMonthlyCost: string;
  tokenBreakdown: string;
  inputTokens: string;
  outputTokens: string;
  cachedTokens: string;
  rateLimits: string;
  budgetAlert: string;
  costPer1k: string;
  switchBot: string;
  mobileSimulator: string;
  agentBuilderSection: string;

  // Conversation
  user: string;
  bot: string;
  searchingKnowledge: string;
  sourcesFound: string;
  executingTool: string;
  copy: string;
  copied: string;
  regenerate: string;
  goodResponse: string;
  badResponse: string;
  streaming: string;
  emptyHistory: string;
  noActiveConversation: string;

  // Bots Section
  botsTitle: string;
  botsSubtitle: string;
  newBotBtn: string;
  chatWithBot: string;
  editBot: string;
  testBot: string;
  botLiveSimulation: string;
  botConfiguration: string;
  identity: string;
  botName: string;
  botDescription: string;
  instructions: string;
  model: string;
  connectedKnowledge: string;
  behavior: string;
  temperature: string;
  saveChanges: string;
  sourcesCount: string;
  toolsCount: string;
  testBotDesc: string;
  testBotSendHint: string;
  clearSimulation: string;

  // Tools Section
  toolsTitle: string;
  toolsSubtitle: string;
  addTool: string;
  searchTools: string;
  connected: string;
  disconnected: string;
  needsSetup: string;
  configure: string;
  enabled: string;
  disabled: string;
  published: string;
  unpublished: string;
  publishBot: string;
  unpublishBot: string;
  apiKeyOrEndpoint: string;
  testConnection: string;
  saveConfiguration: string;
  createCustomTool: string;
  createCustomToolDesc: string;
  toolName: string;
  toolPurpose: string;
  category: string;
  categoryWeb: string;
  categoryData: string;
  categoryDev: string;
  categoryCloud: string;
  categoryModel: string;
  toolTelemetry: string;
  totalInvocations: string;
  p99Latency: string;
  lastInvoked: string;
  callsCount: string;
  operational: string;
  systemRegistry: string;
  simpleBotBadge: string;
  agentBotBadge: string;
  addRule: string;
  triggerWord: string;
  triggerResponse: string;
  filterSimple: string;
  filterAgent: string;

  // Knowledge Section
  knowledgeTitle: string;
  knowledgeSubtitle: string;
  addKnowledge: string;
  uploadFiles: string;
  dragDropFiles: string;
  fileFormatsHint: string;
  uploading: string;
  processing: string;
  indexing: string;
  ready: string;
  failed: string;
  chunksIndexed: string;
  fileSize: string;
  searchKnowledge: string;
  updated: string;
  files: string;

  // Settings
  settingsTitle: string;
  appearance: string;
  themeColor: string;
  colorMode: string;
  light: string;
  dark: string;
  system: string;
  language: string;
  english: string;
  persian: string;
  activePlan: string;
  monthlyTokens: string;
  monthlyRuns: string;
  close: string;
  customColor: string;
  m3ThemeDesc: string;
  accountAndWorkspace: string;
  accountTier: string;
  proWorkspace: string;
  dangerZone: string;
  resetWorkspace: string;
  resetConfirm: string;
  apply: string;
  applied: string;
  mobileStatus: string;
  generalChatMode: string;
  botGenerationMode: string;
  botGenerationHero: string;
  botGenerationSubtitle: string;
  appName: string;
  authTagline: string;
  authSignInTitle: string;
  authSignUpTitle: string;
  authEmail: string;
  authPassword: string;
  authName: string;
  authFullName: string;
  authContinue: string;
  authCreateAccount: string;
  authNoAccount: string;
  authHaveAccount: string;
  authForgot: string;
  authRememberMe: string;
  authGoogle: string;
  authGithub: string;
  authOr: string;
  authSignOut: string;
  authBackToApp: string;
  authFooter: string;
  authCheckPasswords: string;
  preview: string;
  hidePreview: string;
  inDevelopment: string;
  toolPlaygroundInDev: string;
  toolInDevDesc: string;
  selectMood: string;
  botMoodDesc: string;
  toolMoodDesc: string;
  addCapability: string;
  adjustHyperparameters: string;

  // Global & General
  cancel: string;
  save: string;
  delete: string;
  rename: string;
  all: string;
  active: string;
  error: string;
}

export const translations: Record<SupportedLocale, Translations> = {
  en: {
    // Navigation
    workspace: 'Workspace',
    newChat: 'New Chat',
    bots: 'Bots',
    tools: 'Tools',
    knowledge: 'Knowledge',
    history: 'History',
    today: 'Today',
    yesterday: 'Yesterday',
    previous7Days: 'Previous 7 days',
    older: 'Older',
    settings: 'Settings',
    profile: 'Profile',
    usage: 'Usage',
    account: 'Account',
    search: 'Search',
    searchPlaceholder: 'Search chats, bots, tools...',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',

    // New Chat (Home)
    heroTitle: 'What can I help you build?',
    heroSubtitle: 'Choose Bot Building or Tool Building mode below to architect agents and integrations.',
    askAnything: 'Ask anything...',
    attachFiles: 'Attach files',
    selectKnowledge: 'Knowledge',
    selectBot: 'Bot',
    send: 'Send',
    stop: 'Stop',
    suggestedPrompts: 'Suggested:',
    suggAnalyzeDoc: 'Analyze a document',
    suggResearchTopic: 'Research a topic',
    suggCreateReport: 'Create a report',
    suggAnalyzeData: 'Analyze my data',

    // Three Creation Modes
    botBuildingMode: 'Agent Bot (LLM & Tools)',
    toolBuildingMode: 'Tool & Webhook Integration',
    toolBuildingDesc: 'Custom REST APIs, functions, and Model Context Protocol (MCP) servers.',
    agentBotTitle: 'Agent Bot (LLM & Tools)',
    agentBotDesc: 'Autonomous multi-step reasoning, Gemini models, vector knowledge, and tools.',
    simpleBotTitle: 'Simple Static Bot (Deterministic)',
    simpleBotDesc: 'Instant condition-action keyword rules without any LLM models, tools, or knowledge.',
    disabledComingSoon: 'Disabled (Coming Soon)',
    enabledActive: 'Enabled & Active',
    botOverview: 'Bot Overview',
    developBot: 'Open Studio / Develop',
    backToOverview: 'Back to Overview',
    changeIcon: 'Change Icon',
    selectEmoji: 'Select Icon Emoji',
    deterministic: 'Deterministic',
    deterministicRules: 'Deterministic Rule Triggers',
    botBuildingPlaceholder: 'Describe the bot to build (purpose, tone, rules, tools)...',
    toolBuildingPlaceholder: 'Describe the external tool or API integration to build...',
    proposedBotTitle: 'Proposed Bot Blueprint',
    proposedToolTitle: 'Proposed Tool Blueprint',
    confirmDeploy: 'Deploy & Open in Studio',
    saveToolToWorkspace: 'Save to Workspace Tools',
    refineWithAgent: 'Refine with Agent',
    editingBotBanner: 'Active Bot Context',
    backToPlayground: 'Open in Studio',

    // Google AI Studio Style Workspace
    studioPlayground: 'Playground',
    overviewMetrics: 'Overview & History',
    getCode: 'Get Code',
    billingAndUsage: 'Billing & Usage',
    systemInstructions: 'System Instructions',
    modelParameters: 'Model & Parameters',
    tune: 'Tune',
    build: 'Build',
    allBots: 'All Bots',
    backToBots: 'Back to Bots',
    businessLogic: 'Business Logic & Tools',
    mcpServers: 'MCP Servers',
    mcpDesc: 'Connect external filesystem, database, or API tools via MCP protocol',
    modelsAndHyperparameters: 'Models & Hyperparameters',
    filterAll: 'All',
    filterActive: 'Published',
    filterDraft: 'Draft',
    openInStudio: 'Open Studio',
    moreActions: 'Actions',
    agentEditTitle: 'Agent Studio & Architecture',
    agentEditSubtitle: 'Converse with the meta agent, attach knowledge/tools, and evolve bot instructions.',
    agentEditPlaceholder: 'Ask the agent to modify prompt, tools, or behavior...',
    applyChanges: 'Apply Changes',
    runSimulation: 'Run Test',
    clearChat: 'Clear Session',
    testPromptPlaceholder: 'Type a message to simulate this bot...',
    version: 'Version',
    totalRuns: 'Total Executions',
    avgLatency: 'Average Latency',
    tokensConsumed: 'Tokens Consumed',
    successRate: 'Success Rate',
    versionHistory: 'Version History',
    conversationsHistory: 'Test Sessions with this Bot',
    pythonSdk: 'Python (google-genai)',
    typeScriptSdk: 'TypeScript (@google/genai)',
    restCurl: 'cURL / REST',
    copyCode: 'Copy Code',

    // Billing & Usage in Playground
    estimatedMonthlyCost: 'Estimated Monthly Cost',
    tokenBreakdown: 'Token Consumption Breakdown',
    inputTokens: 'Prompt Input Tokens',
    outputTokens: 'Candidate Output Tokens',
    cachedTokens: 'Context Cached Tokens',
    rateLimits: 'Rate Limits & Quotas',
    budgetAlert: 'Monthly Spend Cap',
    costPer1k: 'Cost per 1,000 Requests',
    switchBot: 'Active Bot',
    mobileSimulator: 'Mobile Simulation Frame',
    agentBuilderSection: 'Agent Builder & Instructions',

    // Conversation
    user: 'You',
    bot: 'Bot',
    searchingKnowledge: 'Searching knowledge',
    sourcesFound: 'sources found',
    executingTool: 'Executing tool',
    copy: 'Copy',
    copied: 'Copied!',
    regenerate: 'Regenerate',
    goodResponse: 'Good response',
    badResponse: 'Poor response',
    streaming: 'Generating response...',
    emptyHistory: 'No previous conversations.',
    noActiveConversation: 'Start a conversation to see messages.',

    // Bots Section
    botsTitle: 'Studio Playground',
    botsSubtitle: 'Google AI Studio bot workspace with agent instruction editor and mobile simulation frame.',
    newBotBtn: 'Build with Agent',
    chatWithBot: 'Playground',
    editBot: 'Studio',
    testBot: 'Test',
    botLiveSimulation: 'Live Simulation',
    botConfiguration: 'Configuration',
    identity: 'Identity',
    botName: 'Bot Name',
    botDescription: 'Description',
    instructions: 'Instructions (System Prompt)',
    model: 'Model Engine',
    connectedKnowledge: 'Connected Knowledge',
    behavior: 'Behavior',
    temperature: 'Temperature',
    saveChanges: 'Save Changes',
    sourcesCount: 'sources',
    toolsCount: 'tools',
    testBotDesc: 'Test this bot interactively.',
    testBotSendHint: 'Send a test prompt below to verify its behavior.',
    clearSimulation: 'Clear simulation',

    // Tools Section
    toolsTitle: 'Tools',
    toolsSubtitle: 'External capabilities available to agents.',
    addTool: 'Add Tool',
    searchTools: 'Search tools...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    needsSetup: 'Needs setup',
    configure: 'Configure',
    enabled: 'Enabled',
    disabled: 'Disabled',
    published: 'Published',
    unpublished: 'Draft',
    publishBot: 'Publish',
    unpublishBot: 'Unpublish',
    apiKeyOrEndpoint: 'API Key / Endpoint',
    testConnection: 'Test Connection',
    saveConfiguration: 'Save Configuration',
    createCustomTool: 'Create Custom Tool',
    createCustomToolDesc: 'Add a new external API or webhook connection for your agents.',
    toolName: 'Tool Name',
    toolPurpose: 'Tool Purpose / Capability',
    category: 'Category',
    categoryWeb: 'Web',
    categoryData: 'Database',
    categoryDev: 'Developer',
    categoryCloud: 'Cloud',
    categoryModel: 'Model',
    toolTelemetry: 'Tools Observability & Statistics',
    totalInvocations: 'Total Invocations',
    p99Latency: 'P99 Latency',
    lastInvoked: 'Last Invoked',
    callsCount: 'Calls',
    operational: 'Operational',
    systemRegistry: 'System Infrastructure Registry',
    simpleBotBadge: 'Simple (Deterministic)',
    agentBotBadge: 'Agent (LLM)',
    addRule: 'Add Trigger Rule',
    triggerWord: 'Trigger keyword / phrase',
    triggerResponse: 'Instant response text',
    filterSimple: 'Simple Bots (Rule)',
    filterAgent: 'Agent Bots (LLM)',

    // Knowledge Section
    knowledgeTitle: 'Knowledge',
    knowledgeSubtitle: 'Manage documents and datasets available to bots.',
    addKnowledge: 'Add Knowledge',
    uploadFiles: 'Upload Files',
    dragDropFiles: 'Drag and drop files here, or click to browse',
    fileFormatsHint: 'Supports PDF, DOCX, TXT, CSV, XLSX up to 50MB',
    uploading: 'Uploading',
    processing: 'Processing',
    indexing: 'Indexing',
    ready: 'Ready',
    failed: 'Failed',
    chunksIndexed: 'chunks',
    fileSize: 'Size',
    searchKnowledge: 'Search knowledge...',
    updated: 'Updated',
    files: 'files',

    // Settings
    settingsTitle: 'Settings',
    appearance: 'Appearance',
    themeColor: 'Theme Color',
    colorMode: 'Color Mode',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    language: 'Language',
    english: 'English',
    persian: 'فارسی (Persian)',
    activePlan: 'Active Plan',
    monthlyTokens: 'Monthly Tokens',
    monthlyRuns: 'Monthly Runs',
    close: 'Close',
    customColor: 'Custom Color (Full Spectrum)',
    m3ThemeDesc: 'Pick any color from the full spectrum. Material 3 algorithms dynamically synthesize primary, tonal containers, neutral surfaces, and elevation states.',
    accountAndWorkspace: 'Account & Workspace',
    accountTier: 'Account Tier',
    proWorkspace: 'Pro Workspace (Production)',
    dangerZone: 'Danger Zone',
    resetWorkspace: 'Reset Workspace Data',
    resetConfirm: 'Are you sure you want to reset all workspace data to defaults?',
    apply: 'Apply',
    applied: 'Applied',
    mobileStatus: 'Online · Simulation',
    generalChatMode: 'Direct Chat',
    botGenerationMode: 'Bot Builder',
    botGenerationHero: 'Build AI Bots with Meta Agent',
    botGenerationSubtitle: 'Converse with the builder agent below to architect models, tools, and system instructions.',
    appName: 'Aetheris Studio',
    authTagline: 'Design, tune and publish AI agents from one calm workspace.',
    authSignInTitle: 'Welcome back',
    authSignUpTitle: 'Create your workspace',
    authEmail: 'Email',
    authPassword: 'Password',
    authName: 'Name',
    authFullName: 'Full name',
    authContinue: 'Continue',
    authCreateAccount: 'Create account',
    authNoAccount: "Don't have an account?",
    authHaveAccount: 'Already have an account?',
    authForgot: 'Forgot password?',
    authRememberMe: 'Keep me signed in',
    authGoogle: 'Continue with Google',
    authGithub: 'Continue with GitHub',
    authOr: 'or',
    authSignOut: 'Sign out',
    authBackToApp: 'Back to app',
    authFooter: 'By continuing you agree to the Terms and Privacy Policy.',
    authCheckPasswords: 'Passwords must match.',
    preview: 'Preview',
    hidePreview: 'Hide Preview',
    inDevelopment: 'In Development',
    toolPlaygroundInDev: 'Tool Playground (In Development)',
    toolInDevDesc: 'The tool synthesizer engine is currently under development. You can design, configure, and simulate bots now.',
    selectMood: 'Workspace Mood',
    botMoodDesc: 'Build & simulate intelligent bots',
    toolMoodDesc: 'Custom tools & MCP connectors (Alpha)',
    addCapability: 'Add to Bot',
    adjustHyperparameters: 'Hyperparameters & Temp',

    // Global & General
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    rename: 'Rename',
    all: 'All',
    active: 'Active',
    error: 'Error',
  },

  fa: {
    // Navigation
    workspace: 'فضای کاری',
    newChat: 'گفتگوی جدید',
    bots: 'بات‌ها',
    tools: 'ابزارها',
    knowledge: 'منابع دانش',
    history: 'تاریخچه',
    today: 'امروز',
    yesterday: 'دیروز',
    previous7Days: '۷ روز گذشته',
    older: 'قدیمی‌تر',
    settings: 'تنظیمات',
    profile: 'پروفایل',
    usage: 'مصرف و سهمیه',
    account: 'حساب کاربری',
    search: 'جستجو',
    searchPlaceholder: 'جستجوی گفتگوها، بات‌ها، ابزارها...',
    collapseSidebar: 'بستن منو',
    expandSidebar: 'باز کردن منو',

    // New Chat (Home)
    heroTitle: 'چه چیزی می‌خواهید بسازید؟',
    heroSubtitle: 'از بخش ورودی زیر حالت «ساخت بات» یا «ساخت ابزار» را انتخاب کرده و با ایجنت گفتگو کنید.',
    askAnything: 'هر سوالی دارید بپرسید...',
    attachFiles: 'پیوست فایل',
    selectKnowledge: 'منبع دانش',
    selectBot: 'انتخاب بات',
    send: 'ارسال',
    stop: 'توقف',
    suggestedPrompts: 'پیشنهادات:',
    suggAnalyzeDoc: 'تحلیل یک سند و داده',
    suggResearchTopic: 'تحقیق درباره یک موضوع',
    suggCreateReport: 'ایجاد یک گزارش جامع',
    suggAnalyzeData: 'تحلیل داده‌های آماری',

    // Three Creation Modes
    botBuildingMode: 'ایجنت هوشمند (LLM)',
    toolBuildingMode: 'ساخت ابزار و وب‌هوک',
    toolBuildingDesc: 'توسعه APIها، توابع و کانکتورهای پروتکل MCP.',
    agentBotTitle: 'ایجنت هوشمند (مبتنی بر LLM و ابزارها)',
    agentBotDesc: 'ترکیب استدلال، مدل‌های زبانی، ابزارها و بازیابی دانش متصل.',
    simpleBotTitle: 'بات ساده و قطعی (بدون مدل)',
    simpleBotDesc: 'قوانین شرط و پاسخ آنی با تاخیر ۰ میلی‌ثانیه بدون نیاز به مدل، ابزار و دانش.',
    disabledComingSoon: 'غیرفعال (به‌زودی)',
    enabledActive: 'فعال و آماده ساخت',
    botOverview: 'نمای کلی بات',
    developBot: 'ورود به استودیو / توسعه',
    backToOverview: 'بازگشت به نمای کلی',
    changeIcon: 'تغییر آیکون',
    selectEmoji: 'انتخاب ایموجی آیکون',
    deterministic: 'قطعی (بدون مدل)',
    deterministicRules: 'قوانین و پاسخ‌های قطعی',
    botBuildingPlaceholder: 'باتی که می‌خواهید بسازید را توصیف کنید (اهداف، لحن، قوانین، ابزارها)...',
    toolBuildingPlaceholder: 'ابزار یا وب‌سرویسی که می‌خواهید طراحی شود را توصیف کنید...',
    proposedBotTitle: 'طرح پیشنهادی بات هوشمند',
    proposedToolTitle: 'طرح پیشنهادی ابزار هوشمند',
    confirmDeploy: 'تایید و باز کردن در استودیو',
    saveToolToWorkspace: 'افزودن به ابزارهای فضای کاری',
    refineWithAgent: 'تنظیم مجدد با ایجنت',
    editingBotBanner: 'بات فعال در بافت ایجنت',
    backToPlayground: 'باز کردن در استودیو',

    // Google AI Studio Style Workspace
    studioPlayground: 'پلی‌گراند استودیو',
    overviewMetrics: 'داشبورد و تاریخچه',
    getCode: 'دریافت کد (Get Code)',
    billingAndUsage: 'هزینه و مصرف',
    systemInstructions: 'دستورالعمل‌های سیستم (System Instructions)',
    modelParameters: 'مدل و پارامترها (Parameters)',
    tune: 'کوک',
    build: 'ساخت',
    allBots: 'همه ایجنت‌ها',
    backToBots: 'بازگشت به ایجنت‌ها',
    businessLogic: 'منطق کاری و ابزارها',
    mcpServers: 'سرورهای پروتکل MCP',
    mcpDesc: 'اتصال ابزارهای سرور، فایل و پایگاه داده با پروتکل کانتکست (MCP)',
    modelsAndHyperparameters: 'مدل‌ها و هایپرپارامترها',
    filterAll: 'همه',
    filterActive: 'منتشر شده',
    filterDraft: 'پیش‌نویس',
    openInStudio: 'ورود به استودیو',
    moreActions: 'عملیات',
    agentEditTitle: 'استودیوی ایجنت و ساخت',
    agentEditSubtitle: 'گفتگو با ایجنت طراح، اتصال دانش/ابزارها و ارتقای دستورالعمل‌های بات.',
    agentEditPlaceholder: 'به ایجنت بگویید چه تغییری در پرامپت یا رفتار بات ایجاد کند...',
    applyChanges: 'اعمال تغییرات',
    runSimulation: 'اجرای تست',
    clearChat: 'پاک‌سازی نشست',
    testPromptPlaceholder: 'یک پیام برای شبیه‌سازی رفتار این بات وارد کنید...',
    version: 'نسخه',
    totalRuns: 'تعداد کل اجراها',
    avgLatency: 'میانگین زمان پاسخ',
    tokensConsumed: 'توکن‌های مصرف‌شده',
    successRate: 'درصد پاسخ‌های موفق',
    versionHistory: 'تاریخچه نسخه‌ها',
    conversationsHistory: 'نشست‌های آزمایشی این بات',
    pythonSdk: 'پایتون (google-genai)',
    typeScriptSdk: 'تایپ‌اسکریپت (@google/genai)',
    restCurl: 'درخواست وب (cURL)',
    copyCode: 'کپی کد',

    // Billing & Usage in Playground
    estimatedMonthlyCost: 'برآورد هزینه ماهانه',
    tokenBreakdown: 'تفکیک توکن‌های مصرفی',
    inputTokens: 'توکن‌های ورودی (Prompt)',
    outputTokens: 'توکن‌های خروجی (Candidate)',
    cachedTokens: 'توکن‌های کش‌شده کانتکست',
    rateLimits: 'محدودیت‌های نرخ مصرف (Quotas)',
    budgetAlert: 'سقف بودجه ماهانه',
    costPer1k: 'هزینه هر ۱۰۰۰ اجرا',
    switchBot: 'بات فعال',
    mobileSimulator: 'شبیه‌ساز تلفن همراه',
    agentBuilderSection: 'بخش طراح و پرامپت سیستم',

    // Conversation
    user: 'شما',
    bot: 'بات',
    searchingKnowledge: 'جستجو در منابع دانش',
    sourcesFound: 'منبع مرتبط یافت شد',
    executingTool: 'اجرای ابزار',
    copy: 'کپی',
    copied: 'کپی شد!',
    regenerate: 'تولید مجدد',
    goodResponse: 'پاسخ مناسب',
    badResponse: 'پاسخ نامناسب',
    streaming: 'در حال نگارش پاسخ...',
    emptyHistory: 'گفتگوی قبلی وجود ندارد.',
    noActiveConversation: 'برای مشاهده پیام‌ها، گفتگو را آغاز کنید.',

    // Bots Section
    botsTitle: 'پلی‌گراند استودیو',
    botsSubtitle: 'محیط طراحی بات به سبک Google AI Studio همراه با ویرایشگر ایجنت و شبیه‌ساز موبایل.',
    newBotBtn: 'ساخت با ایجنت',
    chatWithBot: 'پلی‌گراند',
    editBot: 'استودیو',
    testBot: 'آزمایش',
    botLiveSimulation: 'پیش‌نمایش زنده',
    botConfiguration: 'پیکربندی بات',
    identity: 'هویت و نام',
    botName: 'نام بات',
    botDescription: 'توضیحات کوتاه',
    instructions: 'دستورالعمل‌ها (پرامپت سیستم)',
    model: 'موتور مدل هوش مصنوعی',
    connectedKnowledge: 'منابع دانش متصل',
    behavior: 'رفتار و پارامترها',
    temperature: 'درجه حرارت (دقت / خلاقیت)',
    saveChanges: 'ذخیره تغییرات',
    sourcesCount: 'منبع دانش',
    toolsCount: 'ابزار',
    testBotDesc: 'آزمایش رفتار بات به صورت تعاملی.',
    testBotSendHint: 'یک پیام آزمایشی ارسال کنید تا پاسخ بات را بسنجید.',
    clearSimulation: 'پاک‌سازی شبیه‌ساز',

    // Tools Section
    toolsTitle: 'ابزارها',
    toolsSubtitle: 'قابلیت‌ها و رابط‌های خارجی در دسترس بات‌ها.',
    addTool: 'افزودن ابزار',
    searchTools: 'جستجوی ابزارها...',
    connected: 'متصل',
    disconnected: 'قطع شده',
    needsSetup: 'نیاز به تنظیمات',
    configure: 'پیکربندی',
    enabled: 'فعال',
    disabled: 'غیرفعال',
    published: 'منتشر شده',
    unpublished: 'پیش‌نویس',
    publishBot: 'انتشار',
    unpublishBot: 'لغو انتشار',
    apiKeyOrEndpoint: 'کلید وب‌سرویس / نشانی اینترنتی (API Key)',
    testConnection: 'بررسی اتصال',
    saveConfiguration: 'ذخیره پیکربندی',
    createCustomTool: 'ایجاد ابزار سفارشی',
    createCustomToolDesc: 'یک API یا وب‌هوک جدید برای اتصال به بات‌های هوشمند اضافه کنید.',
    toolName: 'نام ابزار',
    toolPurpose: 'کاربرد و قابلیت ابزار',
    category: 'دسته‌بندی',
    categoryWeb: 'وب و اینترنت',
    categoryData: 'پایگاه داده',
    categoryDev: 'ابزار برنامه‌نویسی',
    categoryCloud: 'سرویس ابری',
    categoryModel: 'مدل محاسباتی',
    toolTelemetry: 'آمار و نظارت بر کارکرد ابزارها',
    totalInvocations: 'مجموع فراخوانی‌ها',
    p99Latency: 'تاخیر صدک ۹۹ (P99)',
    lastInvoked: 'آخرین اجرا',
    callsCount: 'فراخوانی',
    operational: 'عملیاتی و آماده',
    systemRegistry: 'رجیستری زیرساخت سیستم',
    simpleBotBadge: 'بات ساده (قانون‌محور)',
    agentBotBadge: 'ایجنت هوشمند (مدل LLM)',
    addRule: 'افزودن قانون قطعی',
    triggerWord: 'کلمه یا عبارت محرک',
    triggerResponse: 'پاسخ بلادرنگ قطعی',
    filterSimple: 'بات‌های ساده (قانون)',
    filterAgent: 'ایجنت‌ها (مدل)',

    // Knowledge Section
    knowledgeTitle: 'منابع دانش',
    knowledgeSubtitle: 'مدیریت اسناد، فایل‌ها و داده‌های قابل بازیابی برای بات‌ها.',
    addKnowledge: 'افزودن دانش',
    uploadFiles: 'بارگذاری فایل‌ها',
    dragDropFiles: 'فایل‌ها را به اینجا بکشید و رها کنید، یا برای انتخاب کلیک کنید',
    fileFormatsHint: 'پشتیبانی از فرمت‌های PDF، DOCX، TXT، CSV و XLSX تا سقف ۵۰ مگابایت',
    uploading: 'در حال بارگذاری',
    processing: 'در حال پردازش',
    indexing: 'در حال نمایه‌سازی',
    ready: 'آماده',
    failed: 'ناموفق',
    chunksIndexed: 'بخش نمایه‌شده',
    fileSize: 'اندازه',
    searchKnowledge: 'جستجو در منابع دانش...',
    updated: 'به‌روزرسانی',
    files: 'فایل',

    // Settings
    settingsTitle: 'تنظیمات',
    appearance: 'ظاهر و پوسته',
    themeColor: 'رنگ اصلی تم',
    colorMode: 'حالت رنگی',
    light: 'روشن',
    dark: 'تاریک',
    system: 'سیستم',
    language: 'زبان رابط کاربری',
    english: 'English (انگلیسی)',
    persian: 'فارسی',
    activePlan: 'طرح فعال',
    monthlyTokens: 'توکن‌های ماهانه',
    monthlyRuns: 'تعداد اجراهای ماهانه',
    close: 'بستن',
    customColor: 'انتخاب رنگ از طیف کامل (هر رنگی)',
    m3ThemeDesc: 'رنگ دلخواه خود را از طیف گسترده انتخاب نمایید. الگوریتم‌های متریال ۳ گوگل به طور خودکار رنگ‌های اصلی، سطوح میانی، کنتراست‌ها و حالت‌های مختلف را تولید می‌کنند.',
    accountAndWorkspace: 'حساب و فضای کاری',
    accountTier: 'نوع حساب',
    proWorkspace: 'فضای کاری حرفه‌ای (Pro)',
    dangerZone: 'منطقه حساس',
    resetWorkspace: 'بازنشانی اطلاعات به حالت اولیه',
    resetConfirm: 'آیا از بازنشانی داده‌های فضای کاری به مقادیر پیش‌فرض اطمینان دارید؟',
    apply: 'اعمال',
    applied: 'اعمال شد',
    mobileStatus: 'آنلاین · شبیه‌سازی',
    generalChatMode: 'گفتگوی مستقیم',
    botGenerationMode: 'ایجنت سازنده',
    botGenerationHero: 'ساخت و معماری بات با ایجنت',
    botGenerationSubtitle: 'با دستیار طراح در کادر زیر گفتگو کنید تا مدل، ابزارها و پرامپت سیستم تنظیم شود.',
    appName: 'استودیو آتریس',
    authTagline: 'طراحی، تنظیم و انتشار ایجنت‌های هوش مصنوعی در یک محیط آرام.',
    authSignInTitle: 'خوش آمدید',
    authSignUpTitle: 'ساخت فضای کاری',
    authEmail: 'ایمیل',
    authPassword: 'رمز عبور',
    authName: 'نام',
    authFullName: 'نام و نام خانوادگی',
    authContinue: 'ادامه',
    authCreateAccount: 'ساخت حساب',
    authNoAccount: 'حساب کاربری ندارید؟',
    authHaveAccount: 'قبلاً ثبت‌نام کرده‌اید؟',
    authForgot: 'رمز عبور را فراموش کرده‌اید؟',
    authRememberMe: 'مرا وارد نگه دار',
    authGoogle: 'ادامه با گوگل',
    authGithub: 'ادامه با گیت‌هاب',
    authOr: 'یا',
    authSignOut: 'خروج',
    authBackToApp: 'بازگشت به برنامه',
    authFooter: 'با ادامه، قوانین و سیاست حریم خصوصی را می‌پذیرید.',
    authCheckPasswords: 'رمزهای عبور یکسان نیستند.',
    preview: 'پیش‌نمایش',
    hidePreview: 'بستن پیش‌نمایش',
    inDevelopment: 'در حال توسعه',
    toolPlaygroundInDev: 'پلی‌گراند ابزارها (در حال توسعه)',
    toolInDevDesc: 'موتور ساخت و تولید ابزارها در حال توسعه می‌باشد. هم‌اکنون می‌توانید بات‌های هوشمند را طراحی و شبیه‌سازی نمایید.',
    selectMood: 'حالت کاری فضای کار',
    botMoodDesc: 'ساخت، معماری و شبیه‌سازی بات‌ها',
    toolMoodDesc: 'ابزارها و وب‌هوک‌های اختصاصی (آلفا)',
    addCapability: 'افزودن قابلیت به بات',
    adjustHyperparameters: 'پارامترهای مدل و دما',

    // Global & General
    cancel: 'انصراف',
    save: 'ذخیره',
    delete: 'حذف',
    rename: 'تغییر نام',
    all: 'همه',
    active: 'فعال',
    error: 'خطا',
  },
};
