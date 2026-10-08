export type SupportedLocale = 'en' | 'fa';

export interface Translations {
  // Navigation
  workspace: string;
  newChat: string;
  newConversation: string;
  pageNotFound: string;
  backToChat: string;
  somethingWentWrong: string;
  retry: string;
  bots: string;
  chat: string;
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
  comingSoon: string;

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
  tokensConsumed: string;
  successRate: string;
  versionHistory: string;
  conversationsHistory: string;

  // Bot page: view switcher, playground and recent activity
  viewOverview: string;
  viewStudio: string;
  studioTabChat: string;
  studioTabConfigure: string;
  atAGlance: string;
  recentActivity: string;
  noRunsYet: string;
  runInput: string;
  runOutput: string;
  integrations: string;
  noDescription: string;
  playgroundHint: string;
  botOfferTitle: string;
  botOfferBody: string;
  stayInChat: string;
  noModelDeterministic: string;
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


  // The studio: conversation-first bot building
  whatDoYouWantToBuild: string;
  buildPlaceholder: string;
  buildHint: string;
  buildingYourBot: string;
  yourBotIsReady: string;
  created: string;
  previewBot: string;
  openPreview: string;
  collapsePreview: string;
  expandPreview: string;
  previewTitle: string;
  liveBot: string;
  previewEmpty: string;
  previewPlaceholder: string;
  artifactDraft: string;
  artifactReady: string;
  artifactPublished: string;
  publish: string;
  instructionsLabel: string;
  modelLabel: string;
  knowledgeLabel: string;
  toolsLabel: string;
  variablesLabel: string;
  noKnowledge: string;
  noTools: string;
  noVariables: string;
  addVariable: string;
  variableName: string;
  variableValue: string;
  variableHint: string;
  sourceCount: string;
  botMode: string;
  comingSoonModes: string;
  modeMenuTitle: string;

  // The conversation: sender labels, message actions, and the empty state
  youLabel: string;
  assistantLabel: string;
  appTitle: string;
  editMessage: string;
  moreActionsLabel: string;
  runBot: string;
  newChatLabel: string;
  whatChanged: string;
  newResponse: string;
  attachFilesLabel: string;
  removeAttachment: string;
  suggestionSupport: string;
  suggestionSales: string;
  suggestionKnowledge: string;
  chatEmptyHint: string;
  configureBot: string;
  botPreviewName: string;
  // Bot architecture
  rulesLabel: string;
  dataLabel: string;
  actionsLabel: string;
  noRules: string;
  botAiLabel: string;
  botHybridLabel: string;
  botRulesLabel: string;
  botDataLabel: string;
  // Build progress
  progressUnderstanding: string;
  progressPlanning: string;
  progressInstructions: string;
  progressKnowledge: string;
  progressData: string;
  progressActions: string;
  progressVariables: string;
  progressPreparing: string;
  progressTesting: string;
  progressReady: string;
  stepFailed: string;
  detailsLabel: string;
  suggestionData: string;
  suggestionDeterministic: string;

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
    pageNotFound: 'Page not found',
    backToChat: 'Back to chat',
    somethingWentWrong: 'Something went wrong',
    retry: 'Try again',
    newConversation: 'New Conversation',
    newChat: 'New Conversation',
    bots: 'Bots',
    chat: 'Chat',
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
    comingSoon: 'Coming soon',

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
    tokensConsumed: 'Tokens Consumed',
    successRate: 'Success Rate',
    versionHistory: 'Version History',

    // Bot page: view switcher, playground and recent activity
    viewOverview: 'Overview',
    viewStudio: 'Studio',
    studioTabChat: 'Playground',
    studioTabConfigure: 'Configure',
    atAGlance: 'At a glance',
    recentActivity: 'Recent activity',
    noRunsYet: 'No runs yet',
    runInput: 'Input',
    runOutput: 'Output',
    integrations: 'Integrations',
    noDescription: 'No description',
    playgroundHint: 'Test this bot exactly as an end user would.',
    botOfferTitle: 'Bot created',
    botOfferBody: 'Your conversation is saved in the chat history.',
    stayInChat: 'Keep chatting',
    noModelDeterministic: 'No model · deterministic',
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
    appName: 'Aetheris',
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


    // The studio
    whatDoYouWantToBuild: 'What do you want to build?',
    buildPlaceholder: 'Describe the bot you want...',
    buildHint: 'One chat builds one bot. Start a new chat to build a different one.',
    buildingYourBot: 'Building your bot...',
    yourBotIsReady: 'Your bot is ready.',
    created: 'Created',
    previewBot: 'Preview bot',
    openPreview: 'Open preview',
    collapsePreview: 'Collapse preview',
    expandPreview: 'Expand preview',
    previewTitle: 'Bot preview',
    liveBot: 'Live bot',
    previewEmpty: 'Send a message to try your bot.',
    previewPlaceholder: 'Message your bot...',
    artifactDraft: 'Draft',
    artifactReady: 'Ready',
    artifactPublished: 'Published',
    publish: 'Publish',
    instructionsLabel: 'Instructions',
    modelLabel: 'Model',
    knowledgeLabel: 'Knowledge',
    toolsLabel: 'Tools',
    variablesLabel: 'Variables',
    noKnowledge: 'No sources attached',
    noTools: 'No tools attached',
    noVariables: 'No variables',
    addVariable: 'Add variable',
    variableName: 'Name',
    variableValue: 'Value',
    variableHint: 'Reference a variable from the instructions as {{name}}.',
    sourceCount: 'source',
    botMode: 'Bot',
    comingSoonModes: 'Coming soon',
    modeMenuTitle: 'Builder modes',
    youLabel: 'You',
    assistantLabel: 'Bot Builder',
    appTitle: 'Agent Builder',
    editMessage: 'Edit',
    moreActionsLabel: 'More',
    runBot: 'Run',
    newChatLabel: 'New chat',
    whatChanged: 'What changed',
    newResponse: 'New response',
    attachFilesLabel: 'Attach files',
    removeAttachment: 'Remove',
    suggestionSupport: 'Customer support bot',
    suggestionSales: 'Sales assistant',
    suggestionKnowledge: 'Knowledge-based bot',
    chatEmptyHint: "Describe the bot you want, and I'll help you create it.",
    configureBot: 'Configure',
    botPreviewName: 'Preview bot',
    // Bot architecture
    rulesLabel: 'Rules',
    dataLabel: 'Data',
    actionsLabel: 'Actions',
    noRules: 'No rules yet',
    botAiLabel: 'AI',
    botHybridLabel: 'Rules + AI',
    botRulesLabel: 'Rules',
    botDataLabel: 'Database',
    // Build progress
    progressUnderstanding: 'Understanding your requirements',
    progressPlanning: 'Planning the bot',
    progressInstructions: 'Creating instructions',
    progressKnowledge: 'Adding knowledge',
    progressData: 'Configuring database access',
    progressActions: 'Configuring actions',
    progressVariables: 'Setting up variables',
    progressPreparing: 'Preparing the bot',
    progressTesting: 'Testing the configuration',
    progressReady: 'Bot ready',
    stepFailed: "This step couldn't be completed",
    detailsLabel: 'Details',
    suggestionData: 'Reads and updates customer orders',
    suggestionDeterministic: 'Processes refund requests by rule',
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
    pageNotFound: 'صفحه پیدا نشد',
    backToChat: 'بازگشت به گفتگو',
    somethingWentWrong: 'مشکلی پیش آمد',
    retry: 'تلاش دوباره',
    newConversation: 'گفتگوی جدید',
    newChat: 'گفتگوی جدید',
    bots: 'بات‌ها',
    chat: 'گفتگو',
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
    comingSoon: 'به‌زودی',

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
    tokensConsumed: 'توکن‌های مصرف‌شده',
    successRate: 'درصد پاسخ‌های موفق',
    versionHistory: 'تاریخچه نسخه‌ها',

    // صفحه بات: جابه‌جایی نما، زمین بازی و فعالیت اخیر
    viewOverview: 'نمای کلی',
    viewStudio: 'استودیو',
    studioTabChat: 'زمین بازی',
    studioTabConfigure: 'پیکربندی',
    atAGlance: 'نگاه سریع',
    recentActivity: 'فعالیت اخیر',
    noRunsYet: 'هنوز اجرایی ثبت نشده',
    runInput: 'ورودی',
    runOutput: 'خروجی',
    integrations: 'اتصال‌ها',
    noDescription: 'بدون توضیحات',
    playgroundHint: 'بات را دقیقاً مثل کاربر نهایی آزمایش کنید.',
    botOfferTitle: 'بات ساخته شد',
    botOfferBody: 'گفتگوی شما در تاریخچه چت ذخیره شده است.',
    stayInChat: 'ادامه گفتگو',
    noModelDeterministic: 'بدون مدل · قطعی',
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
    appName: 'آتریس',
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


    // The studio
    whatDoYouWantToBuild: '\u0686\u0647 \u0686\u06cc\u0632\u06cc \u0645\u06cc\u062e\u0648\u0627\u0647\u06cc\u062f \u0628\u0633\u0627\u0632\u06cc\u062f\u061f',
    buildPlaceholder: '\u0628\u0627\u062a \u06cc\u06a9\u0633\u0627\u0633\u0628\u0637 \u0645\u06cc\u062e\u0648\u0627\u0647\u06cc\u062f \u0628\u0646\u0648\u06cc\u0633\u06cc\u062f...',
    buildHint: '\u0647\u0631 \u06af\u0641\u062a\u06af\u0648 \u06cc\u06a9 \u0628\u0627\u062a \u0645\u06cc\u0633\u0627\u0632\u06cc\u062f. \u0628\u0631\u0627\u06cc \u0628\u0627\u062a \u062f\u06cc\u06af\u0631 \u06af\u0641\u062a\u06af\u0648 \u0628\u0627\u0632\u06cc\u062f \u062c\u062f\u06cc\u062f \u0628\u0633\u0627\u0632\u06cc\u062f.',
    buildingYourBot: '\u062f\u0627\u0631\u06cc\u062f \u0633\u0627\u062e\u062a\u0646 \u0628\u0627\u062a \u0634\u0645\u0627...',
    yourBotIsReady: '\u0628\u0627\u062a \u0634\u0645\u0627 \u0622\u0645\u0627\u062f\u0647 \u0627\u0633\u062a.',
    created: '\u0633\u0627\u062e\u062a\u0647 \u0634\u062f',
    previewBot: '\u067e\u06cc\u0634\u06cc\u0628\u0627\u0646\u06cc \u0628\u0627\u062a',
    openPreview: '\u0628\u0627\u0632 \u06a9\u0631\u062f\u0646 \u067e\u06cc\u0634\u06cc\u0628\u0627\u0646\u06cc',
    collapsePreview: '\u0628\u0633\u062a\u0646 \u067e\u06cc\u0634\u06cc\u0628\u0627\u0646\u06cc',
    expandPreview: '\u06af\u0633\u062a\u0631\u0627\u0646\u0647 \u067e\u06cc\u0634\u06cc\u0628\u0627\u0646\u06cc',
    previewTitle: '\u067e\u06cc\u0634\u06cc\u0628\u0627\u0646\u06cc \u0628\u0627\u062a',
    liveBot: '\u0628\u0627\u062a \u0632\u0646\u062f\u0647',
    previewEmpty: '\u0628\u0631\u0627\u06cc \u0627\u0632\u0627\u0646\u062f\u0647\u0627\u0646 \u06cc\u06a9 \u067e\u06cc\u0634\u06cc\u0628\u0627\u0646\u06cc \u0628\u0641\u0631\u06cc\u0627\u06cc\u062f.',
    previewPlaceholder: '\u067e\u06cc\u0627\u0645 \u0628\u0647 \u0628\u0627\u062a...',
    artifactDraft: '\u067e\u06cc\u0634\u0646\u0648\u0633',
    artifactReady: '\u0622\u0645\u0627\u062f\u0647',
    artifactPublished: '\u0645\u0646\u062a\u0634\u0631 \u0634\u062f\u0647',
    publish: '\u0627\u0646\u062a\u0634\u0627\u0631',
    instructionsLabel: '\u062f\u0633\u062a\u0648\u0631\u0627\u062a',
    modelLabel: '\u0645\u062f\u0644',
    knowledgeLabel: '\u062f\u0627\u0646\u0634',
    toolsLabel: '\u0627\u0628\u0632\u0627\u0631\u0647\u0627',
    variablesLabel: '\u0645\u062a\u063a\u06cc\u0631\u0647\u0627',
    noKnowledge: '\u0645\u0646\u0628\u0639\u06cc \u0627\u062a\u0635\u0644 \u0646\u0634\u062f\u0647',
    noTools: '\u0627\u0628\u0632\u0627\u0631\u06cc \u0627\u062a\u0635\u0644 \u0646\u0634\u062f\u0647',
    noVariables: '\u0645\u062a\u063a\u06cc\u0631\u06cc \u0646\u06cc\u0633\u062a',
    addVariable: '\u0627\u0641\u0632\u0648\u062f\u0646 \u0645\u062a\u063a\u06cc\u0631',
    variableName: '\u0646\u0627\u0645',
    variableValue: '\u0645\u0642\u0627\u062f\u06cc\u0631',
    variableHint: '\u0628\u0631\u0627\u06cc \u0627\u062f\u0639\u0627\u0646 \u0645\u062a\u063a\u06cc\u0631 \u0627\u0632 \u062f\u0633\u062a\u0648\u0631\u0627\u062a \u0628\u0635\u0648\u0631\u062a {{name}} \u0627\u0633\u062a\u0641\u0627\u0642 \u0628\u06af\u06cc\u0631\u06cc\u062f.',
    sourceCount: '\u0645\u0646\u0628\u0639',
    botMode: '\u0628\u0627\u062a',
    comingSoonModes: '\u0628\u0647\u200c\u0632\u0648\u062f\u06cc',
    modeMenuTitle: '\u062d\u0627\u0644\u062a\u200c\u0647\u0627\u06cc \u0633\u0627\u062e\u062a\u0646',
    youLabel: '\u0634\u0645\u0627',
    assistantLabel: '\u0628\u0627\u062a\u200c\u0633\u0627\u0632',
    appTitle: '\u0633\u0627\u0632\u0647 \u0628\u0627\u062a',
    editMessage: '\u0648\u06cc\u0631\u0627\u06cc\u0634',
    moreActionsLabel: '\u0628\u06cc\u0634\u062a\u0631',
    runBot: '\u0627\u062c\u0631\u0627',
    newChatLabel: '\u06af\u0641\u062a\u06af\u0648\u06cc \u062c\u062f\u06cc\u062f',
    whatChanged: '\u062a\u063a\u06cc\u06cc\u0631\u0627\u062a',
    newResponse: '\u067e\u0627\u0633\u062e \u062c\u062f\u06cc\u062f',
    attachFilesLabel: '\u067e\u06cc\u0648\u0633\u062a \u0641\u0627\u06cc\u0644',
    removeAttachment: '\u062d\u0630\u0641',
    suggestionSupport: '\u0631\u0628\u0627\u062a \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0645\u0634\u062a\u0631\u06cc',
    suggestionSales: '\u062f\u0633\u062a\u06cc\u0627\u0631 \u0641\u0631\u0648\u0634',
    suggestionKnowledge: '\u0631\u0628\u0627\u062a \u062f\u0627\u0646\u0634\u200c\u0645\u062d\u0648\u0631',
    chatEmptyHint: '\u0628\u0627\u062a \u0645\u0648\u0631\u062f\u0646\u0638\u0631\u0627 \u062a\u0648\u0635\u06cc\u0641 \u06a9\u0646\u06cc\u062f\u060c \u0645\u0646 \u0628\u0631\u0627\u06cc \u0633\u0627\u062e\u062a\u0646\u0634 \u0627\u06cc\u0632 \u0631\u0627\u0647\u0646\u062f\u0647 \u0645\u06cc\u06af\u0632\u0645.',
    configureBot: '\u067e\u06cc\u06a9\u0631\u0628\u0646\u062f\u06cc',
    botPreviewName: '\u067e\u06cc\u0634\u06cc\u0628\u0627\u0646\u06cc \u0628\u0627\u062a',
    rulesLabel: '\u0642\u0648\u0627\u0646\u06cc\u0646',
    dataLabel: '\u062f\u0627\u062f\u0647',
    actionsLabel: '\u06a9\u0646\u0634\u200c\u0647\u0627',
    noRules: '\u0647\u0646\u0648\u0632 \u0642\u0627\u0646\u0648\u0646\u06cc \u0646\u06cc\u0633\u062a',
    botAiLabel: '\u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06cc',
    botHybridLabel: '\u0642\u0648\u0627\u0646\u06cc\u0646 + \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06cc',
    botRulesLabel: '\u0642\u0648\u0627\u0646\u06cc\u0646',
    botDataLabel: '\u067e\u0627\u06cc\u06af\u0627\u0647 \u062f\u0627\u062f\u0647',
    progressUnderstanding: '\u062f\u0631\u06a9 \u0646\u06cc\u0627\u0632\u0647\u0627\u06cc \u0634\u0645\u0627',
    progressPlanning: '\u0628\u0631\u0646\u0627\u0645\u0647\u200c\u0631\u06cc\u0632\u06cc \u0628\u0627\u062a',
    progressInstructions: '\u0646\u0648\u0634\u062a\u0646 \u062f\u0633\u062a\u0648\u0631\u0627\u0644\u0639\u0645\u0644\u200c\u0647\u0627',
    progressKnowledge: '\u0627\u0641\u0632\u0648\u062f\u0646 \u062f\u0627\u0646\u0634',
    progressData: '\u067e\u06cc\u06a9\u0631\u0628\u0646\u062f\u06cc \u062f\u0633\u062a\u0631\u0633\u06cc \u0628\u0647 \u067e\u0627\u06cc\u06af\u0627\u0647 \u062f\u0627\u062f\u0647',
    progressActions: '\u067e\u06cc\u06a9\u0631\u0628\u0646\u062f\u06cc \u06a9\u0646\u0634\u200c\u0647\u0627',
    progressVariables: '\u062a\u0646\u0638\u06cc\u0645 \u0645\u062a\u063a\u06cc\u0631\u0647\u0627',
    progressPreparing: '\u0622\u0645\u0627\u062f\u0647\u200c\u0633\u0627\u0632\u06cc \u0628\u0627\u062a',
    progressTesting: '\u0622\u0632\u0645\u0627\u06cc\u0634 \u067e\u06cc\u06a9\u0631\u0628\u0646\u062f\u06cc',
    progressReady: '\u0628\u0627\u062a \u0622\u0645\u0627\u062f\u0647 \u0627\u0633\u062a',
    stepFailed: '\u0627\u06cc\u0646 \u0645\u0631\u062d\u0644\u0647 \u0627\u0646\u062c\u0627\u0645 \u0646\u0634\u062f',
    detailsLabel: '\u062c\u0632\u0626\u06cc\u0627\u062a',
    suggestionData: '\u0633\u0641\u0627\u0631\u0634\u200c\u0647\u0627\u06cc \u0645\u0634\u062a\u0631\u06cc \u0631\u0627 \u0645\u06cc\u200c\u062e\u0648\u0627\u0646\u062f \u0648 \u0628\u0647\u200c\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc \u0645\u06cc\u200c\u06a9\u0646\u062f',
    suggestionDeterministic: '\u062f\u0631\u062e\u0648\u0627\u0633\u062a\u200c\u0647\u0627\u06cc \u0628\u0627\u0632\u06af\u0634\u062a \u0648\u062c\u0647 \u0631\u0627 \u0637\u0628\u0642 \u0642\u0627\u0646\u0648\u0646 \u067e\u0631\u062f\u0627\u0632\u0634 \u0645\u06cc\u200c\u06a9\u0646\u062f',

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
