import { ThreadPrimitive, useThreadViewport } from '@assistant-ui/react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { Composer } from './Composer';
import { MessageItem, ScrollToLatest } from './MessageItem';

/**
 * The starting point: a question, one line of guidance, three ways in.
 *
 * Suggestions are plain text, not cards. Their whole job is to remove the blank page, and they
 * leave the moment there is a real conversation to read — an empty state that competes with the
 * transcript it precedes is just a slower transcript.
 */
const EmptyState: React.FC = () => {
  const { t, setDraft } = useWorkspace();
  const suggestions = [t.suggestionSupport, t.suggestionSales, t.suggestionKnowledge, t.suggestionData];

  return (
    <div className="flex min-h-[52vh] flex-col justify-center" data-testid="empty-state">
      <h1 className="text-[22px] leading-8 font-semibold tracking-tight text-[var(--md-sys-color-on-surface)] sm:text-[26px]">
        {t.whatDoYouWantToBuild}
      </h1>
      <p className="mt-1.5 max-w-[34rem] text-[14px] leading-6 text-[var(--md-sys-color-on-surface-variant)]">
        {t.chatEmptyHint}
      </p>

      <ul className="mt-5 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => {
                setDraft(suggestion);
                document.querySelector<HTMLTextAreaElement>('[data-testid=composer-input]')?.focus();
              }}
              data-testid="suggestion"
              className="cursor-pointer rounded-full border border-[var(--md-sys-color-outline-variant)] px-3 py-1.5 text-[13px] text-[var(--md-sys-color-on-surface)] transition-colors hover:bg-[var(--md-sys-color-state-hover)]"
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * The conversation, as a bot-building session.
 *
 * The conversation *is* the interface: what you want, watching it get built, testing it and refining
 * it all happen in this one column. There is no header, no sidebar and no permanent configuration —
 * the preview appears only once there is a bot to preview, and collapses back into the thread.
 */
export const Thread: React.FC = () => (
  <ThreadPrimitive.Root className="flex h-full min-h-0 flex-1 flex-col">
    <div className="relative min-h-0 flex-1">
      <ThreadPrimitive.Viewport
        // Follow the tail, but only when the user is already there: dragging someone away from an
        // earlier answer to chase an incoming token is the fastest way to make a chat feel hostile.
        autoScroll
        turnAnchor="bottom"
        className="h-full overflow-y-auto px-4 sm:px-6"
        data-testid="transcript"
      >
        <div className="mx-auto w-full max-w-[46rem] py-6 sm:py-8">
          <ThreadPrimitive.Empty>
            <EmptyState />
          </ThreadPrimitive.Empty>

          {/* One component for both senders: Assistant UI already knows the role, and the renderer
              branches on it, which keeps the two from drifting apart. */}
          <ThreadPrimitive.Messages className="space-y-7" components={{ Message: () => <MessageItem /> }} />
        </div>
      </ThreadPrimitive.Viewport>

      <JumpToLatest />
    </div>

    <div className="shrink-0 px-4 pb-4 pt-1 sm:px-6">
      <div className="mx-auto max-w-[46rem]">
        <Composer />
      </div>
    </div>
  </ThreadPrimitive.Root>
);

/**
 * "Jump to the newest response".
 *
 * Rendered only when the viewport is away from the bottom. This is the affordance that makes
 * following-the-tail safe: because the return trip is always one click away, auto-scrolling can
 * follow the stream without ever trapping the reader further up.
 */
const JumpToLatest: React.FC = () => {
  const isAtBottom = useThreadViewport((s) => s.isAtBottom);
  if (isAtBottom) return null;

  return (
    <div className="pointer-events-none sticky bottom-3 flex justify-center">
      <div className="pointer-events-auto">
        <ScrollToLatest />
      </div>
    </div>
  );
};
