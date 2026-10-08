import React, { useMemo } from 'react';
import { MoreHorizontal, Play } from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { ArtifactStatus, BotItem } from '../../types/agent';
import type { Translations } from '../../lib/i18n/translations';
import { describeBotShape } from '../../lib/botArchitecture';
import { IconButton } from '../ui/IconButton';
import { Menu, MenuItem } from '../ui/Menu';

const STATUS_LABEL: Record<ArtifactStatus, keyof Translations> = {
  draft: 'artifactDraft',
  ready: 'artifactReady',
  published: 'artifactPublished',
};

const STATUS_DOT: Record<ArtifactStatus, string> = {
  draft: 'bg-[var(--md-sys-color-on-surface-variant)]',
  ready: 'bg-[var(--md-sys-color-primary)]',
  published: 'bg-[var(--md-sys-color-primary)]',
};

/**
 * The bot this conversation has built, attached to the turn that produced it.
 *
 * It reads as a *result*, not a panel: a hairline down the leading edge, the name, and one line
 * naming what the bot is actually made of. Those parts are derived from the bot itself, so a
 * rules-and-database bot says "Rules · Data" and never claims to have a model it does not use.
 *
 * A framed block here would compete with the words around it, and the words are the interface.
 */
export const BotArtifact: React.FC<{
  bot: BotItem;
  status: ArtifactStatus;
  isPreviewOpen: boolean;
  onOpenPreview: () => void;
}> = ({ bot, status, isPreviewOpen, onOpenPreview }) => {
  const { t, publishArtifact, tools } = useWorkspace();
  const [open, setOpen] = useState(false);
  const anchor = React.useRef<HTMLDivElement>(null);

  const shape = useMemo(() => describeBotShape(bot, tools), [bot, tools]);

  // What the bot is made of, and only what it is made of. A deterministic bot has no knowledge and
  // no model, so neither is listed; a bot with three actions says so instead of saying "Tools".
  const parts: string[] = [];
  if (shape.hasRules) parts.push(t.rulesLabel);
  if (shape.dataToolIds.length > 0) parts.push(t.dataLabel);
  if (shape.usesModel && bot.instructions) parts.push(t.instructionsLabel);
  if (shape.hasKnowledge) parts.push(t.knowledgeLabel);
  if (shape.actionToolIds.length > 0) parts.push(t.actionsLabel);
  if (bot.variables?.length) parts.push(`${t.variablesLabel} (${bot.variables.length})`);

  return (
    <div
      className="my-4 border-s-2 border-[var(--md-sys-color-outline-variant)] ps-3.5"
      data-testid="bot-artifact"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-[14px] font-medium text-[var(--md-sys-color-on-surface)]">{bot.name}</span>
        {/* The dot carries the status; the word beside it means it is never colour-only. */}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
          {t[STATUS_LABEL[status]]}
        </span>
      </div>

      {parts.length > 0 && (
        <p className="mt-0.5 text-[12px] text-[var(--md-sys-color-on-surface-variant)]">{parts.join(' · ')}</p>
      )}

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenPreview}
          data-testid="preview-bot"
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[var(--md-sys-color-primary)] transition-colors hover:bg-[var(--md-sys-color-state-hover)]"
        >
          <Play size={13} />
          {isPreviewOpen ? t.expandPreview : t.previewBot}
        </button>

        <div className="relative" ref={anchor}>
          <IconButton
            label={t.moreActionsLabel}
            onClick={() => setOpen((v) => !v)}
            testId="artifact-more"
          >
            <MoreHorizontal size={13} />
          </IconButton>
          <Menu open={open} anchorRef={anchor} onClose={() => setOpen(false)} label={t.moreActionsLabel} width={172}>
            <MenuItem
              label={t.publishBot}
              disabled={status === 'published'}
              onClick={publishArtifact}
              testId="artifact-publish"
            />
          </Menu>
        </div>
      </div>
    </div>
  );
};