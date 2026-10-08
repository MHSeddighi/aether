import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { IconButton } from '../ui/IconButton';
import { CompactConfig } from './CompactConfig';
import { SendGlyph } from '../chat/Composer';

/**
 * The contextual bot preview.
 *
 * It is a workspace, not a destination: it opens beside the conversation, stays bound to it, and
 * collapsing it never discards anything. Configuration is a disclosure rather than a second
 * sidebar — the user is here to *talk to the bot*, and the settings that shape it are one tap away
 * when the answer they are reading is wrong.
 *
 * Only the sections this bot actually has appear inside Configure; a deterministic bot is never
 * shown a model picker it cannot use.
 */
export const BotPreviewPanel: React.FC = () => {
  const { t, artifact, previewMessages, isPreviewStreaming, sendPreviewMessage, closePreview } = useWorkspace();
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Follow the tail as answers stream in, but only when the user is already near the bottom.
  // Yanking the viewport away mid-read is the fastest way to make a chat feel hostile.
  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 160) node.scrollTop = node.scrollHeight;
  }, [previewMessages]);

  if (!artifact) return null;

  return (
    <aside
      className="flex h-full w-full min-w-0 flex-col bg-[var(--md-sys-color-surface-container-lowest)] lg:border-s lg:border-[var(--md-sys-color-outline-variant)]"
      aria-label={t.previewTitle}
      data-testid="preview-panel"
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--md-sys-color-outline-variant)] px-2 sm:px-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
          {artifact.name}
        </h2>

        <button
          type="button"
          onClick={() => setIsConfigOpen((v) => !v)}
          aria-expanded={isConfigOpen}
          aria-label={t.configureBot}
          data-testid="toggle-config"
          className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors hover:bg-[var(--md-sys-color-state-hover)] ${
            isConfigOpen
              ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]'
              : 'text-[var(--md-sys-color-on-surface-variant)]'
          }`}
        >
          <SlidersHorizontal size={14} />
          <span className="hidden sm:inline">{t.configureBot}</span>
        </button>

        <IconButton
          label={t.collapsePreview}
          onClick={closePreview}
          size="md"
          tooltipPlacement="bottom"
          testId="collapse-preview"
        >
          <X size={16} />
        </IconButton>
      </header>

      {isConfigOpen && (
        <div
          className="max-h-[50%] shrink-0 overflow-y-auto border-b border-[var(--md-sys-color-outline-variant)]"
          data-testid="config-pane"
        >
          <CompactConfig bot={artifact} />
        </div>
      )}

      <div
        ref={transcriptRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4"
        data-testid="preview-transcript"
      >
        {previewMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-[18rem] text-center text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
              {t.previewEmpty}
            </p>
          </div>
        ) : (
          previewMessages.map((message) => (
            <div
              key={message.id}
              data-testid="preview-message"
              className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-6 ${
                message.sender === 'user'
                  ? 'ms-auto rounded-ee-sm bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]'
                  : 'me-auto rounded-es-sm bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)]'
              }`}
            >
              {message.content || (message.isStreaming ? t.streaming : '')}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 p-2">
        <div
          className="rounded-2xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] transition-colors focus-within:border-[var(--md-sys-color-outline)]"
          data-testid="preview-input"
        >
          <div className="flex items-end gap-1 p-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line — IME composition must win, or typing in
                // Persian or Japanese would send a half-finished word.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const text = draft.trim();
                  if (!text || isPreviewStreaming) return;
                  sendPreviewMessage(text);
                  setDraft('');
                }
              }}
              rows={1}
              placeholder={t.previewPlaceholder}
              aria-label={t.previewPlaceholder}
              className="my-1.5 min-h-6 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] leading-6 text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)]"
            />
            <button
              type="button"
              onClick={() => {
                const text = draft.trim();
                if (!text || isPreviewStreaming) return;
                sendPreviewMessage(text);
                setDraft('');
              }}
              disabled={!draft.trim() || isPreviewStreaming}
              aria-label={t.send}
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
            >
              <SendGlyph />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};