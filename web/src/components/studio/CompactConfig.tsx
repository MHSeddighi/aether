import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus, Trash2, Upload } from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { BotItem, BotVariable, KnowledgeItem } from '../../types/agent';
import { modelsApi, type CatalogModel } from '../../lib/api';
import { describeBotShape } from '../../lib/botArchitecture';
import { IconButton } from '../ui/IconButton';

const chip =
  'inline-flex items-center gap-1.5 rounded-md border border-[var(--md-sys-color-outline-variant)] px-2 py-1 text-[11px] text-[var(--md-sys-color-on-surface)]';

const field =
  'h-8 w-full rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-2.5 text-xs text-[var(--md-sys-color-on-surface)] outline-none transition-colors placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:border-[var(--md-sys-color-outline)]';

/**
 * A section that hides its body until it is asked for.
 *
 * The bot's own settings are the first thing worth reading and the last thing worth configuring, so
 * the two highest-value sections start open and everything else waits. A flat scroll of
 * equally-weighted settings would be a form; this is a surface you look things up on.
 */
const Disclosure: React.FC<{
  label: string;
  summary?: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}> = ({ label, summary, defaultOpen = false, action, testId, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-[var(--md-sys-color-outline-variant)] last:border-b-0" data-testid={testId}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-start transition-colors hover:bg-[var(--md-sys-color-state-hover)]"
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-[var(--md-sys-color-on-surface-variant)] transition-transform duration-150 motion-reduce:transition-none ${
              open ? 'rotate-90' : ''
            }`}
          />
          <span className="text-[12px] font-medium text-[var(--md-sys-color-on-surface)]">{label}</span>
          {!open && summary && (
            <span className="truncate text-[11px] text-[var(--md-sys-color-on-surface-variant)]">{summary}</span>
          )}
        </button>
        {action}
      </div>

      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
};

/**
 * Debounces a save so a textarea does not append an immutable version per keystroke.
 *
 * The version history is the point of the backend's append-only design, but a bot that gains 200
 * versions from one sentence edit is noise rather than history.
 */
function useDebouncedSave(save: (changes: Partial<BotItem>) => Promise<void>) {
  const pending = useRef<Partial<BotItem>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = React.useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const changes = pending.current;
    pending.current = {};
    if (Object.keys(changes).length > 0) await save(changes);
  }, [save]);

  const queue = React.useCallback(
    (changes: Partial<BotItem>) => {
      pending.current = { ...pending.current, ...changes };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 600);
    },
    [flush]
  );

  // A pending edit must not be lost to an unmount (switching chats, collapsing the panel).
  useEffect(() => () => void flush(), [flush]);

  return queue;
}

function InstructionsEditor({ bot, onSave }: { bot: BotItem; onSave: (c: Partial<BotItem>) => void }) {
  const { t } = useWorkspace();
  const [draft, setDraft] = useState(bot.instructions);
  const lastSeen = useRef(bot.instructions);

  // Re-sync when the conversation rewrites the bot, but never while the user is mid-sentence.
  if (lastSeen.current !== bot.instructions && draft === lastSeen.current) {
    lastSeen.current = bot.instructions;
    setDraft(bot.instructions);
  }

  return (
    <textarea
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        lastSeen.current = e.target.value;
        onSave({ instructions: e.target.value });
      }}
      rows={5}
      spellCheck={false}
      placeholder={t.instructionsLabel}
      aria-label={t.instructionsLabel}
      data-testid="config-instructions"
      className="w-full resize-y rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-2.5 py-2 text-xs leading-5 text-[var(--md-sys-color-on-surface)] outline-none transition-colors placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:border-[var(--md-sys-color-outline)]"
    />
  );
}

function ModelPicker({ bot, onSave }: { bot: BotItem; onSave: (c: Partial<BotItem>) => void }) {
  const { t } = useWorkspace();
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);

  useEffect(() => {
    let live = true;
    // The catalog is dynamic, so it is fetched rather than hard-coded: a stale hard-coded list
    // silently writes a provider the backend rejects.
    void modelsApi
      .list()
      .then((models) => {
        if (live) setCatalog(models);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const options = useMemo(() => catalog ?? [], [catalog]);

  return (
    <select
      value={bot.modelId ?? ''}
      onChange={(e) => {
        const chosen = options.find((m) => m.modelId === e.target.value);
        if (chosen) onSave({ modelId: chosen.modelId, provider: chosen.provider });
      }}
      aria-label={t.modelLabel}
      data-testid="config-model"
      className={field}
    >
      {options.length === 0 && <option value={bot.modelId ?? ''}>{bot.model || bot.modelId || '—'}</option>}
      {options.map((model) => (
        <option key={`${model.provider}:${model.modelId}`} value={model.modelId}>
          {model.label}
        </option>
      ))}
    </select>
  );
}

/** A multi-select rendered as toggleable chips: one tap to attach, one to detach. */
function Attacher<T extends { id: string; name: string }>({
  available,
  attachedIds,
  emptyLabel,
  onToggle,
  testId,
}: {
  available: T[];
  attachedIds: string[];
  emptyLabel: string;
  onToggle: (id: string) => void;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      {available.length === 0 ? (
        <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {available.map((item) => {
            const on = attachedIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggle(item.id)}
                aria-pressed={on}
                className={`${chip} cursor-pointer transition-colors ${
                  on
                    ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]'
                    : 'hover:bg-[var(--md-sys-color-state-hover)]'
                }`}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The bot's rules, read as the behaviour a person would describe.
 *
 * This is the one place deterministic logic is legible without opening the transcript: a trigger and
 * what the bot says when it fires. Editing rewrites the same fields the conversation would, because
 * there is only one bot and one set of rules.
 */
function RulesEditor({ bot, onSave }: { bot: BotItem; onSave: (c: Partial<BotItem>) => void }) {
  const { t } = useWorkspace();
  const rules = bot.deterministicRules ?? [];

  const commit = (next: { trigger: string; response: string }[]) => {
    onSave({ deterministicRules: next, botType: 'simple' });
  };

  if (rules.length === 0) {
    return <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">{t.noRules}</p>;
  }

  return (
    <div className="space-y-1.5">
      {rules.map((rule, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            value={rule.trigger}
            onChange={(e) => {
              const next = [...rules];
              next[index] = { ...rule, trigger: e.target.value };
              commit(next);
            }}
            aria-label={t.variableName}
            placeholder={t.variableName}
            className={field}
          />
          <input
            value={rule.response}
            onChange={(e) => {
              const next = [...rules];
              next[index] = { ...rule, response: e.target.value };
              commit(next);
            }}
            aria-label={t.variableValue}
            placeholder={t.variableValue}
            className={field}
          />
          <IconButton label={`${t.delete} ${rule.trigger}`} onClick={() => commit(rules.filter((_, i) => i !== index))}>
            <Trash2 size={13} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

function VariablesEditor({
  variables,
  onSave,
}: {
  variables: BotVariable[];
  onSave: (c: Partial<BotItem>) => void;
}) {
  const { t } = useWorkspace();

  const commit = (next: BotVariable[]) => onSave({ variables: next });

  return (
    <div className="space-y-1.5">
      {variables.map((variable, index) => (
        <div key={variable.name || index} className="flex items-center gap-1.5">
          <input
            value={variable.name}
            onChange={(e) => {
              const next = [...variables];
              next[index] = { ...variable, name: e.target.value };
              commit(next);
            }}
            placeholder={t.variableName}
            aria-label={t.variableName}
            className={field}
          />
          <input
            value={variable.value}
            onChange={(e) => {
              const next = [...variables];
              next[index] = { ...variable, value: e.target.value };
              commit(next);
            }}
            placeholder={t.variableValue}
            aria-label={t.variableValue}
            className={field}
          />
          <IconButton
            label={`${t.delete} ${variable.name}`}
            onClick={() => commit(variables.filter((_, i) => i !== index))}
          >
            <Trash2 size={13} />
          </IconButton>
        </div>
      ))}

      <button
        type="button"
        onClick={() => commit([...variables, { name: '', value: '' }])}
        className={`${chip} w-full cursor-pointer justify-center transition-colors hover:bg-[var(--md-sys-color-state-hover)]`}
      >
        <Plus size={11} />
        {t.addVariable}
      </button>
      <p className="text-[10px] leading-4 text-[var(--md-sys-color-on-surface-variant)]">{t.variableHint}</p>
    </div>
  );
}

/**
 * The bot's configuration — as much of it as this particular bot actually has.
 *
 * The product concept is "Bot", not "Agent", so the sections are chosen from the bot's own shape
 * rather than fixed. A deterministic bot shows rules and the data it touches; an AI bot shows
 * instructions, model and knowledge; a hybrid shows the combination. A bot that does not call a
 * model is never offered a model picker, because a setting that cannot affect the bot is noise
 * pretending to be control.
 */
export const CompactConfig: React.FC<{ bot: BotItem }> = ({ bot }) => {
  const { t, tools, knowledge, uploadFiles, saveArtifact } = useWorkspace();
  const queue = useDebouncedSave(saveArtifact);
  const fileInput = useRef<HTMLInputElement>(null);

  const shape = useMemo(() => describeBotShape(bot, tools), [bot, tools]);

  const knowledgeById = useMemo(() => new Map(knowledge.map((k) => [k.id, k] as const)), [knowledge]);
  const attachableKnowledge: KnowledgeItem[] = useMemo(
    () => knowledge.filter((k) => k.status === 'Ready'),
    [knowledge]
  );

  const dataTools = useMemo(
    () => tools.filter((tool) => shape.dataToolIds.includes(tool.id)),
    [tools, shape.dataToolIds]
  );
  const actionTools = useMemo(
    () => tools.filter((tool) => shape.actionToolIds.includes(tool.id)),
    [tools, shape.actionToolIds]
  );

  const toggle = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

  const countLabel = (count: number, empty: string) => (count === 0 ? empty : String(count));

  return (
    <div data-testid="compact-config">
      {shape.hasRules && (
        <Disclosure label={t.rulesLabel} defaultOpen testId="config-rules-section">
          <RulesEditor bot={bot} onSave={queue} />
        </Disclosure>
      )}

      {shape.usesModel && (
        <Disclosure label={t.instructionsLabel} defaultOpen testId="config-instructions-section">
          <InstructionsEditor bot={bot} onSave={queue} />
        </Disclosure>
      )}

      {/* Only ever shown when a model is actually part of the answer. */}
      {shape.usesModel && (
        <Disclosure label={t.modelLabel} testId="config-model-section">
          <ModelPicker bot={bot} onSave={queue} />
        </Disclosure>
      )}

      {dataTools.length > 0 && (
        <Disclosure
          label={t.dataLabel}
          summary={countLabel(dataTools.length, t.noTools)}
          testId="config-data-section"
        >
          <Attacher
            available={dataTools}
            attachedIds={bot.toolIds}
            emptyLabel={t.noTools}
            onToggle={(id) => queue({ toolIds: toggle(bot.toolIds, id) })}
            testId="config-data"
          />
        </Disclosure>
      )}

      {actionTools.length > 0 && (
        <Disclosure
          label={t.actionsLabel}
          summary={countLabel(actionTools.length, t.noTools)}
          testId="config-actions-section"
        >
          <Attacher
            available={actionTools}
            attachedIds={bot.toolIds}
            emptyLabel={t.noTools}
            onToggle={(id) => queue({ toolIds: toggle(bot.toolIds, id) })}
            testId="config-actions"
          />
        </Disclosure>
      )}

      {(shape.usesModel || shape.architecture === 'hybrid') && (
        <Disclosure
          label={t.knowledgeLabel}
          summary={countLabel(bot.knowledgeIds.length, t.noKnowledge)}
          testId="config-knowledge-section"
          action={
            <IconButton label={t.addKnowledge} onClick={() => fileInput.current?.click()}>
              <Upload size={13} />
            </IconButton>
          }
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              uploadFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          {bot.knowledgeIds.length > 0 && (
            <ul className="mb-2 space-y-1">
              {bot.knowledgeIds.map((id) => {
                const name = knowledgeById.get(id)?.name ?? id;
                return (
                  <li key={id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--md-sys-color-on-surface)]">
                      {name}
                    </span>
                    <IconButton
                      label={`${t.delete} ${name}`}
                      onClick={() => queue({ knowledgeIds: toggle(bot.knowledgeIds, id) })}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
          {attachableKnowledge.filter((k) => !bot.knowledgeIds.includes(k.id)).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachableKnowledge
                .filter((k) => !bot.knowledgeIds.includes(k.id))
                .map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => queue({ knowledgeIds: [...bot.knowledgeIds, source.id] })}
                    className={`${chip} cursor-pointer border-dashed transition-colors hover:bg-[var(--md-sys-color-state-hover)]`}
                  >
                    <Plus size={10} />
                    {source.name}
                  </button>
                ))}
            </div>
          )}
        </Disclosure>
      )}

      <Disclosure
        label={t.variablesLabel}
        summary={countLabel(bot.variables?.length ?? 0, t.noVariables)}
        testId="config-variables-section"
      >
        <VariablesEditor variables={bot.variables ?? []} onSave={queue} />
      </Disclosure>
    </div>
  );
};