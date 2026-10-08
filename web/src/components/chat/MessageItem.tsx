import { useEffect, useRef, useState } from 'react';
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from '@assistant-ui/react';
import { ArrowDown, Check, Copy, MoreHorizontal, Pencil, RefreshCw, Square, TriangleAlert, X } from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { IconButton } from '../ui/IconButton';
import { Menu, MenuItem } from '../ui/Menu';
import { AssistantMarkdown } from './AssistantMarkdown';
import { BotArtifact } from '../studio/BotArtifact';
import { BuildActivity } from './BuildActivity';
import { messageMeta } from './BotBuilderRuntime';

/**
 * A turn of the conversation.
 *
 * The two senders are told apart by alignment and weight, not by containers. The user's request is
 * compact and set apart; the agent's answer is open editorial text with no frame at all, so the
 * transcript reads as a document rather than a stack of chat bubbles. That single asymmetry is the
 * whole layout rule — everything else here is supporting it.
 */
export const MessageItem: React.FC = () => {
  const role = useAuiState((s) => s.message.role);
  return role === 'user' ? <UserMessage /> : <AssistantMessage />;
};

/**
 * The request, as the user wrote it.
 *
 * The only filled surface in the transcript, and deliberately small: it anchors the eye without
 * competing with the answer that follows it.
 */
const UserMessage: React.FC = () => {
  const { t } = useWorkspace();
  const [editing, setEditing] = useState(false);

  return (
    <MessagePrimitive.Root className="group flex flex-col items-end" data-testid="message-user">
      <p className="mb-1 px-0.5 text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
        {t.youLabel}
      </p>

      <MessagePrimitive.Parts
        components={{
          Text: ({ text }: { text: string }) => (
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-sm bg-[var(--md-sys-color-secondary-container)] px-3.5 py-2 text-[14px] leading-6 text-[var(--md-sys-color-on-secondary-container)]">
              {text}
            </div>
          ),
        }}
      />

      <MessageAttachments />

      {!editing && <UserActions onEdit={() => setEditing(true)} />}
      {editing && <EditHint onDismiss={() => setEditing(false)} />}
    </MessagePrimitive.Root>
  );
};

/** Files the user brought to this turn, listed rather than previewed. */
const MessageAttachments: React.FC = () => {
  const attachments = useAuiState((s) => messageMeta(s.message.metadata?.custom).attachments);
  if (attachments.length === 0) return null;

  return (
    <ul className="mt-1 flex max-w-[85%] flex-wrap justify-end gap-1" data-testid="message-attachments">
      {attachments.map((file) => (
        <li
          key={file.name}
          className="rounded border border-[var(--md-sys-color-outline-variant)] px-1.5 py-0.5 text-[11px] text-[var(--md-sys-color-on-surface-variant)]"
        >
          {file.name}
        </li>
      ))}
    </ul>
  );
};

/**
 * Contextual actions, revealed on hover or focus.
 *
 * `focus-within` is what keeps them reachable: a hover-only row is invisible to a keyboard user and
 * would leave the transcript without Copy or Edit for anyone not using a mouse.
 */
const ActionRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
    {children}
  </div>
);

const CopyButton: React.FC = () => {
  const { t } = useWorkspace();
  const text = useAuiState((s) => s.message.parts.map((p) => ('text' in p ? p.text : '')).join(''));
  const [copied, setCopied] = useState(false);

  return (
    <IconButton
      label={copied ? t.copied : t.copy}
      testId="message-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be denied; the text is still selectable on screen.
        }
      }}
    >
      {copied ? <Check size={13} className="text-[var(--md-sys-color-primary)]" /> : <Copy size={13} />}
    </IconButton>
  );
};

const UserActions: React.FC<{ onEdit: () => void }> = ({ onEdit }) => {
  const { t } = useWorkspace();
  return (
    <ActionRow>
      <IconButton label={t.editMessage} onClick={onEdit} testId="message-edit">
        <Pencil size={13} />
      </IconButton>
      <CopyButton />
    </ActionRow>
  );
};

/**
 * "Editing your message above" — a correction, not a rewrite.
 *
 * The durable conversation is an append-only record, so an edited turn cannot replace the original
 * message. Rather than pretend otherwise, this reopens the message in the composer and re-asks it:
 * the transcript gains a turn, nothing is lost, and the user can see exactly what changed.
 */
const EditHint: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  const { t, setComposerSeed } = useWorkspace();
  const text = useAuiState((s) => s.message.parts.map((p) => ('text' in p ? p.text : '')).join(''));

  return (
    <div
      className="mt-1 flex items-center gap-2 text-[11px] text-[var(--md-sys-color-on-surface-variant)]"
      data-testid="edit-hint"
    >
      <button
        type="button"
        onClick={() => {
          setComposerSeed(text);
          onDismiss();
          document.querySelector<HTMLTextAreaElement>('[data-testid=composer-input]')?.focus();
        }}
        className="flex cursor-pointer items-center gap-1 font-medium text-[var(--md-sys-color-primary)] transition-colors hover:underline"
      >
        {t.editMessage}
        <Pencil size={11} />
      </button>
      <IconButton label={t.cancel} onClick={onDismiss} size="sm">
        <X size={12} />
      </IconButton>
    </div>
  );
};

/** Feedback, kept in the overflow because it is the least time-critical action on a message. */
const MoreMenu: React.FC<{ messageId: string; feedback: 'good' | 'bad' | null }> = ({
  messageId,
  feedback,
}) => {
  const { t, setMessageFeedback } = useWorkspace();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  return (
    <div className="relative" ref={anchor}>
      <IconButton
        label={t.moreActionsLabel}
        onClick={() => setOpen((v) => !v)}
        testId="message-more"
      >
        <MoreHorizontal size={14} />
      </IconButton>
      <Menu open={open} anchorRef={anchor} onClose={() => setOpen(false)} label={t.moreActionsLabel} width={180}>
        <MenuItem
          label={t.goodResponse}
          testId="message-feedback-good"
          onClick={() => setMessageFeedback(messageId, 'good')}
          selected={feedback === 'good'}
        />
        <MenuItem
          label={t.badResponse}
          testId="message-feedback-bad"
          onClick={() => setMessageFeedback(messageId, 'bad')}
          selected={feedback === 'bad'}
        />
      </Menu>
    </div>
  );
};

/**
 * The agent's answer.
 *
 * Identity is a 16px mark beside the name — small enough to stay an identifier rather than becoming
 * the layout's focal point, and reused for the activity list and errors so one icon consistently
 * means "the system did this".
 */
const AssistantMessage: React.FC = () => {
  const { t, buildProgress, retryLastMessage, regenerateLastMessage, artifact, artifactStatus, isPreviewOpen, openPreview } =
    useWorkspace();
  const messageId = useAuiState((s) => s.message.id);
  const isLast = useAuiState((s) => s.message.isLast);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const { isStreaming, failed, feedback } = useAuiState((s) => messageMeta(s.message.metadata?.custom));
  const steps = buildProgress[messageId] ?? [];

  // Actions belong to a settled answer. A turn that is still arriving has no stable text to copy and
  // no final state to retry, and a row that appears and disappears mid-read is noise.
  const settled = !isStreaming && !isRunning;
  const hasText = useAuiState((s) => s.message.parts.some((p) => 'text' in p && p.text.length > 0));

  return (
    <MessagePrimitive.Root className="group flex flex-col items-start" data-testid="message-bot">
      <AgentIdentity />

      <div className="w-full max-w-[44rem]">
        {isStreaming && !hasText ? (
          // Understated generation state: one breathing line, not a spinner or a skeleton.
          <span
            className="inline-flex items-center gap-1.5 py-1 text-[13px] text-[var(--md-sys-color-on-surface-variant)]"
            data-testid="generating"
            role="status"
            aria-live="polite"
          >
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--md-sys-color-primary)] motion-reduce:animate-none"
              aria-hidden="true"
            />
            {t.streaming}
          </span>
        ) : (
          <MessagePrimitive.Parts components={{ Text: () => <AssistantMarkdown testId="message-content" /> }} />
        )}

        {failed && (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--md-sys-color-error)]" data-testid="message-error">
            <TriangleAlert size={13} className="shrink-0" />
            <span>{t.stepFailed}</span>
            <button
              type="button"
              onClick={retryLastMessage}
              data-testid="message-retry"
              className="cursor-pointer font-medium text-[var(--md-sys-color-primary)] transition-opacity hover:opacity-80"
            >
              {t.retry}
            </button>
          </div>
        )}

        <BuildActivity steps={steps} running={isRunning && Boolean(steps.length)} />
      </div>

      {/* The bot this conversation produced, attached to the turn that produced it. It rides along
          with the message rather than floating somewhere the user has to go looking for it, and it
          appears only once there is a bot — never a preview before the bot is ready. */}
      {isLast && artifact && (
        <BotArtifact
          bot={artifact}
          status={artifactStatus}
          isPreviewOpen={isPreviewOpen}
          onOpenPreview={openPreview}
        />
      )}

      {settled && hasText && !failed && (
        <ActionRow>
          <CopyButton />
          {isLast && (
            <IconButton label={t.regenerate} onClick={regenerateLastMessage} testId="message-regenerate">
              <RefreshCw size={13} />
            </IconButton>
          )}
          <MoreMenu messageId={messageId} feedback={feedback} />
        </ActionRow>
      )}
    </MessagePrimitive.Root>
  );
};

/**
 * The system, named.
 *
 * The same 16px mark and label for every message the agent writes, every stage it reports and every
 * error it hits, so the user always knows which side of the conversation they are reading.
 */
const AgentIdentity: React.FC = () => {
  const { t } = useWorkspace();
  return (
    <div className="mb-1 flex items-center gap-1.5 px-0.5" data-testid="agent-identity">
      <AgentMark />
      <span className="text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
        {t.assistantLabel}
      </span>
    </div>
  );
};

/**
 * The bot builder's mark: a small glyph, tinted by the current colour.
 *
 * Sized in `em` so it tracks the 11px label beside it, and monochrome on purpose — it identifies
 * the agent, so it must not compete with the words it sits next to.
 */
export const AgentMark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={`shrink-0 text-[var(--md-sys-color-primary)] ${className}`}
  >
    <path
      d="M12 2.5C12.9 8 16 11.1 21.5 12 16 12.9 12.9 16 12 21.5 11.1 16 8 12.9 2.5 12 8 11.1 11.1 8 12 2.5Z"
      fill="currentColor"
      opacity="0.9"
    />
    <circle cx="12" cy="12" r="2.4" fill="var(--md-sys-color-surface)" />
  </svg>
);

/**
 * "Jump to the newest response".
 *
 * Only rendered when the user has scrolled away from the bottom. Following a live stream should
 * never yank someone out of an earlier answer, so the viewport follows the tail on its own and this
 * offers the return trip.
 */
export const ScrollToLatest: React.FC = () => {
  const { t } = useWorkspace();
  const scrollToBottom = ThreadPrimitive.ScrollToBottom;

  return (
    <scrollToBottom
      className="flex cursor-pointer items-center gap-1 rounded-full border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-1.5 text-[12px] font-medium text-[var(--md-sys-color-on-surface)] shadow-[0_1px_3px_rgba(0,0,0,0.16)] transition-colors hover:bg-[var(--md-sys-color-state-hover)]"
      data-testid="new-response"
    >
      <ArrowDown size={13} />
      {t.newResponse}
    </scrollToBottom>
  );
};

/** The Stop control, which replaces Send while a turn is running. */
export const ComposerStop: React.FC = () => {
  const { t } = useWorkspace();
  return (
    <ComposerPrimitive.Cancel
      aria-label={t.stop}
      data-testid="composer-stop"
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] transition-opacity hover:opacity-90"
    >
      <Square size={12} fill="currentColor" />
    </ComposerPrimitive.Cancel>
  );
};