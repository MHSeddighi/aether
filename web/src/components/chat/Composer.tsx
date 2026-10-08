import { useEffect, useRef, useState } from 'react';
import { AttachmentPrimitive, ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { Bot as BotGlyph, ChevronDown, Plus, Square, X } from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { Menu, MenuItem } from '../ui/Menu';

/**
 * The composer.
 *
 * This is the only permanent UI in the chat, so it carries everything the user needs and nothing
 * else: attach, choose what kind of thing to build, write the request, send. The mode selector lives
 * *here* rather than in a header because the mode is part of the request — it qualifies what is
 * being described — so it belongs next to the words it qualifies, and disappears with the surface
 * when the user never touches it.
 *
 * The send/stop swap is Assistant UI's: Send is disabled when there is nothing to send, Stop exists
 * exactly while a run is in flight, and the runtime owns both transitions.
 */

/**
 * What kind of thing to build.
 *
 * Compact, and inside the input. The future modes are listed but inert: a menu entry that says
 * "Coming soon" and does nothing is a promise, and designing builders the product does not have is
 * how interfaces end up full of half-features.
 */
const ModeSelector: React.FC = () => {
  const { t, agentMode, setAgentMode } = useWorkspace();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  return (
    <div className="relative" ref={anchor}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="composer-mode"
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:bg-[var(--md-sys-color-state-hover)] hover:text-[var(--md-sys-color-on-surface)]"
      >
        <BotGlyph size={14} />
        {t.botMode}
        <ChevronDown size={12} />
      </button>

      <Menu
        open={open}
        anchorRef={anchor}
        onClose={() => setOpen(false)}
        label={t.modeMenuTitle}
        width={196}
      >
        <MenuItem
          label={t.botMode}
          icon={<BotGlyph size={13} />}
          selected={agentMode === 'agent-bot'}
          onClick={() => {
            setAgentMode('agent-bot');
            setOpen(false);
          }}
          testId="composer-mode-bot"
        />
        <MenuItem
          label={t.tools}
          disabled
          supporting={t.comingSoon}
          onClick={() => setOpen(false)}
          testId="composer-mode-coming-soon"
        />
      </Menu>
    </div>
  );
};

/** A file the user added, as a chip with one way out. */
const AttachmentChip: React.FC = () => {
  const { t } = useWorkspace();

  return (
    <AttachmentPrimitive.Root
      className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] py-0.5 pe-0.5 ps-2 text-[11px] text-[var(--md-sys-color-on-surface)]"
      data-testid="attachment-chip"
    >
      <AttachmentPrimitive.Name />
      <AttachmentPrimitive.Remove
        aria-label={t.removeAttachment}
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:bg-[var(--md-sys-color-state-hover)]"
      >
        <X size={11} />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
};

export const Composer: React.FC = () => {
  const { t, composerSeed, clearComposerSeed } = useWorkspace();
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const attachmentCount = useAuiState((s) => s.composer.attachments.length);

  /**
   * Reopening an earlier request in the composer.
   *
   * The durable conversation is append-only, so editing a message in place cannot be represented.
   * Re-asking it is: the transcript gains a turn and nothing is lost.
   */
  useEffect(() => {
    if (!composerSeed) return;
    aui.composer.setText(composerSeed);
    clearComposerSeed();
  }, [aui, composerSeed, clearComposerSeed]);

  return (
    <ComposerPrimitive.Root
      className="rounded-2xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] transition-colors focus-within:border-[var(--md-sys-color-outline)]"
      data-testid="composer"
    >
      {attachmentCount > 0 && (
        <ComposerPrimitive.Attachments
          components={{ Attachment: AttachmentChip }}
          className="flex flex-wrap gap-1.5 px-3 pt-2.5"
          aria-label={t.attachFilesLabel}
          data-testid="composer-attachments"
        />
      )}

      <div className="flex items-end gap-1 p-1.5">
        <ComposerPrimitive.AddAttachment
          multiple
          aria-label={t.attachFilesLabel}
          data-testid="composer-attach"
          className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:bg-[var(--md-sys-color-state-hover)] hover:text-[var(--md-sys-color-on-surface)]"
        >
          <Plus size={18} />
        </ComposerPrimitive.AddAttachment>

        <ModeSelector />

        <ComposerPrimitive.Input
          ref={inputRef}
          rows={1}
          placeholder={t.buildPlaceholder}
          aria-label={t.buildPlaceholder}
          data-testid="composer-input"
          // Enter sends; Shift+Enter breaks the line. IME composition wins, or typing in Persian or
          // Japanese would send a half-finished word.
          submitMode="enter"
          addAttachmentOnPaste
          // Bounded growth: past this the field scrolls internally rather than pushing the
          // conversation off screen.
          maxRows={8}
          className="my-1.5 min-h-6 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] leading-6 text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)]"
        />

        {isRunning ? (
          <ComposerPrimitive.Cancel
            aria-label={t.stop}
            data-testid="composer-stop"
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] transition-opacity hover:opacity-90"
          >
            <Square size={12} fill="currentColor" />
          </ComposerPrimitive.Cancel>
        ) : (
          <ComposerPrimitive.Send
            aria-label={t.send}
            data-testid="composer-send"
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
          >
            <SendGlyph />
          </ComposerPrimitive.Send>
        )}
      </div>

      </ComposerPrimitive.Root>
  );
};

/** An arrow, not a paper plane: one direction, one meaning. */
export const SendGlyph: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 19V5M5 12l7-7 7 7"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

