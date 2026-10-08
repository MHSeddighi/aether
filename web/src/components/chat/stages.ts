import type { Translations } from '../../lib/i18n/translations';

/**
 * The build activity vocabulary.
 *
 * A bot can be built by a model, by rules, against a data source, or by a mix, so these stages are
 * the union of what any of them need. Only the stages a run actually reaches are shown: a rules-only
 * bot never displays a knowledge stage, and a bot that reads records never displays a model stage.
 *
 * The list is derived from run events, which are the only honest source available — the frontend is
 * never told "the model is thinking", it is told a step started and a step finished.
 */
export type StageId =
  | 'understanding'
  | 'planning'
  | 'instructions'
  | 'knowledge'
  | 'data'
  | 'actions'
  | 'variables'
  | 'preparing'
  | 'testing';

export type StageStatus = 'running' | 'done' | 'failed';

export interface ProgressStep {
  id: StageId;
  label: string;
  status: StageStatus;
}

/** The localised wording for each stage. */
const STAGE_LABEL: Record<StageId, keyof Translations> = {
  understanding: 'progressUnderstanding',
  planning: 'progressPlanning',
  instructions: 'progressInstructions',
  knowledge: 'progressKnowledge',
  data: 'progressData',
  actions: 'progressActions',
  variables: 'progressVariables',
  preparing: 'progressPreparing',
  testing: 'progressTesting',
};

/**
 * Which activity a tool belongs to.
 *
 * Tools are grouped by what they do *to the bot* rather than by their names, so a knowledge lookup
 * and a record lookup read as two different activities while still being one short list. The match
 * is on the tool id because that is what the event carries, and it is never shown to the user.
 */
export function stageForTool(toolId: string): StageId {
  const id = toolId.toLowerCase();
  if (/knowledge|search|retriev|document|rag|embedding/.test(id)) return 'knowledge';
  if (/sql|database|db|query|record|table|order|customer|inventory|crm/.test(id)) return 'data';
  return 'actions';
}

/**
 * Folds one run event into the activity list.
 *
 * Only events that correspond to something the user would recognise are handled. Everything else —
 * heartbeats, sequence numbers, token deltas — returns the list untouched, which is what keeps this
 * from turning into a developer log.
 */
export function reduceProgress(
  prev: ProgressStep[],
  event: { type: string; data: Record<string, unknown> },
  t: Translations
): ProgressStep[] {
  const open = (id: StageId): ProgressStep[] => {
    const closed = prev.map((step) =>
      step.status === 'running' ? { ...step, status: 'done' as const } : step
    );
    const existing = closed.findIndex((step) => step.id === id);
    if (existing === -1) return [...closed, { id, label: t[STAGE_LABEL[id]], status: 'running' }];
    return closed.map((step, index) =>
      index === existing ? { ...step, label: t[STAGE_LABEL[id]], status: 'running' as const } : step
    );
  };

  switch (event.type) {
    case 'run.started':
    case 'agent.started':
      // The list starts here rather than at send time, so the activity reflects work that actually
      // began rather than an assumption that it has.
      return prev.length > 0 ? prev : open('understanding');
    case 'agent.step.started':
      return open('planning');
    case 'tool.started': {
      const toolId = String(event.data.toolId ?? event.data.tool ?? '');
      return toolId ? open(stageForTool(toolId)) : prev;
    }
    case 'tool.completed': {
      const toolId = String(event.data.toolId ?? event.data.tool ?? '');
      if (!toolId) return prev;
      const id = stageForTool(toolId);
      return prev.map((step) =>
        step.id === id && step.status === 'running' ? { ...step, status: 'done' as const } : step
      );
    }
    case 'tool.failed': {
      const toolId = String(event.data.toolId ?? event.data.tool ?? '');
      if (!toolId) return prev;
      const id = stageForTool(toolId);
      return prev.map((step) => (step.id === id ? { ...step, status: 'failed' as const } : step));
    }
    case 'agent.completed':
      return open('preparing');
    case 'message.completed':
      return open('testing');
    case 'run.completed':
      return finishProgress(prev);
    case 'run.failed':
      return prev.map((step) =>
        step.status === 'running' ? { ...step, status: 'failed' as const } : step
      );
    case 'run.cancelled':
      return finishProgress(prev);
    default:
      return prev;
  }
}

/** Closes whatever is still open. The list stays visible so the user can read what was done. */
export function finishProgress(steps: ProgressStep[]): ProgressStep[] {
  return steps.map((step) => (step.status === 'running' ? { ...step, status: 'done' as const } : step));
}