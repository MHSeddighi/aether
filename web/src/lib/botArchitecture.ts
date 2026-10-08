import type { BotItem, ToolItem } from '../types/agent';

/**
 * What a bot actually *is*, as opposed to how it was built.
 *
 * The product concept is "Bot", not "Agent": a bot may answer with a model, follow deterministic
 * rules, read and write records in a data source, or combine all three. The backend stores that as
 * `botType` plus whatever the bot actually declares, so the shape is derived here rather than
 * invented — the point is that the interface can show a bot the settings it really has, instead of
 * offering every bot the same AI-agent panel.
 */
export type BotArchitecture = 'ai' | 'hybrid' | 'deterministic' | 'data';

export interface BotShape {
  architecture: BotArchitecture;
  /** A model actually backs this bot's answers. Rules-only bots have none. */
  usesModel: boolean;
  hasRules: boolean;
  hasKnowledge: boolean;
  /** Tools that read or write data (databases, APIs over records). */
  dataToolIds: string[];
  /** Tools that do something in the world (searches, HTTP calls, MCP connectors). */
  actionToolIds: string[];
}

/**
 * Classifies a bot from what it declares.
 *
 * Deliberately conservative: a rules-only bot is `deterministic` even if it still carries leftover
 * instructions, because those instructions are never executed. Anything that reaches a model —
 * a configured model, knowledge, or an action tool — makes the bot AI-backed.
 */
export function describeBotShape(bot: BotItem, tools: ToolItem[]): BotShape {
  const declared = new Set(bot.toolIds);
  const attached = tools.filter((tool) => declared.has(tool.id));

  const dataToolIds = attached.filter((tool) => tool.category === 'data').map((tool) => tool.id);
  const actionToolIds = attached.filter((tool) => tool.category !== 'data').map((tool) => tool.id);
  const hasRules = (bot.deterministicRules?.length ?? 0) > 0 || bot.botType === 'simple';
  const hasKnowledge = bot.knowledgeIds.length > 0;
  const usesModel =
    !hasRules && (Boolean(bot.provider || bot.modelId) || hasKnowledge || actionToolIds.length > 0);

  const architecture: BotArchitecture = hasRules
    ? usesModel || hasKnowledge || actionToolIds.length > 0
      ? 'hybrid'
      : 'deterministic'
    : dataToolIds.length > 0 && !usesModel
      ? 'data'
      : 'ai';

  return { architecture, usesModel, hasRules, hasKnowledge, dataToolIds, actionToolIds };
}

