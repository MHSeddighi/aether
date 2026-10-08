export type ConnectionState = 'Connected' | 'Disconnected' | 'Needs setup' | 'Error';
export type KnowledgeStatus = 'Uploading' | 'Processing' | 'Indexing' | 'Ready' | 'Failed';
export type HistoryCategory = 'today' | 'yesterday' | 'previous7Days' | 'older';
export type BotType = 'agent' | 'simple';

export interface ToolItem {
  id: string;
  name: string;
  nameFa?: string;
  purpose: string;
  purposeFa?: string;
  icon: string;
  connectionState: ConnectionState;
  category: 'search' | 'compute' | 'data' | 'api' | 'mcp';
  enabled: boolean;
  config?: Record<string, any>;
}

export interface KnowledgeItem {
  id: string;
  name: string;
  nameFa?: string;
  type: 'pdf' | 'csv' | 'json' | 'doc' | 'text';
  fileCount: number;
  sizeFormatted: string;
  status: KnowledgeStatus;
  progressPercent: number;
  chunksCount: number;
  updatedAt: string;
}

/**
 * A named constant a bot declares and its runner substitutes into the instructions at run time.
 * Referenced from `instructions` as `{{name}}`; the backend owns both the name pattern and the
 * substitution, so the client only renders and collects it.
 */
export interface BotVariable {
  name: string;
  value: string;
  description?: string;
}

export interface BotVersion {
  version: string;
  versionId?: string;
  updatedAt: string;
  notes: string;
  model: string;
  provider?: string;
  modelId?: string;
  temperature: number;
}

export interface BotMetrics {
  totalRuns: number;
  avgLatencyMs: number;
  tokensConsumed: number;
  successRatePercent: number;
}

export interface BotBillingUsage {
  monthlyEstimatedCost: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costPerThousandRequests: number;
  rpmQuota: number;
  tpmQuota: number;
  monthlyBudgetCap: number;
}

export interface BotItem {
  id: string;
  name: string;
  nameFa?: string;
  botType?: BotType;
  deterministicRules?: { trigger: string; response: string }[];
  description: string;
  descriptionFa?: string;
  avatarIcon: string;
  avatarBg: string;
  model: string;
  //: Present on server responses; the backend owns model identity (Rule 4).
  provider?: string;
  modelId?: string;
  instructions: string;
  instructionsFa?: string;
  toolIds: string[];
  knowledgeIds: string[];
  variables: BotVariable[];
  temperature: number;
  topP?: number;
  maxOutputTokens?: number;
  status: 'active' | 'draft' | 'archived';
  enabled: boolean;
  version: string;
  versions: BotVersion[];
  metrics: BotMetrics;
  billingUsage?: BotBillingUsage;
  lastUsed: string;
}

export interface BotProposal {
  proposedBot: Partial<BotItem>;
  isConfirmed?: boolean;
  codeSnippet?: string;
}

/**
 * Lifecycle of the bot a conversation produces. `draft` until the AI has built it, `ready` once it
 * has been exercised in the preview, `published` after the user ships it.
 */
export type ArtifactStatus = 'draft' | 'ready' | 'published';

export interface ToolProposal {
  proposedTool: Partial<ToolItem>;
  isConfirmed?: boolean;
  codeSnippet?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  botProposal?: BotProposal;
  toolProposal?: ToolProposal;
  toolActivity?: {
    name: string;
    status: 'completed' | 'running' | 'failed';
    detail: string;
  }[];
  knowledgeRetrieval?: {
    count: number;
    sources: string[];
  };
  attachments?: {
    name: string;
    sizeFormatted: string;
    type: string;
  }[];
  feedback?: 'good' | 'bad';
}

export interface ChatConversation {
  id: string;
  title: string;
  /**
   * The bot this conversation is about. It points at the builder host until the AI produces the
   * first artifact, and at that artifact from then on — one chat, one bot.
   */
  botId: string;
  category: HistoryCategory;
  updatedAt: string;
  messages: ChatMessage[];
  isPinned?: boolean;
  mode?: 'agent-bot' | 'simple-bot' | 'bot-building' | 'tool-building';
}

export interface WorkspaceAccount {
  id: string;
  name: string;
  plan: string;
  runsUsed: number;
  runsLimit: number;
  tokensUsedMillion: number;
  tokensLimitMillion: number;
}

// --- durable execution (backend contract) --------------------------------

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export interface RunFailure {
  kind: 'model' | 'validation' | 'tool' | 'security' | 'internal' | 'deadline' | 'cancelled';
  reason: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface RunRecord {
  id: string;
  botId: string;
  botVersionId: string;
  botVersion: string;
  status: RunStatus;
  input: string;
  conversationId: string | null;
  assistantMessageId: string | null;
  model: { provider: string; modelId: string; label: string; temperature: number };
  failure: RunFailure | null;
  output: string | null;
  steps: number;
  repairs: number;
  latencyMs: number | null;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface RunEvent {
  seq: number;
  id: string;
  runId: string;
  type: string;
  ts: string;
  data: Record<string, unknown>;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}
