import React from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { BotBuilderRuntime } from './BotBuilderRuntime';
import { Thread } from './Thread';
import { BotPreviewPanel } from '../studio/BotPreviewPanel';

/**
 * The Bot Builder.
 *
 * The whole workspace is the conversation: no header, no sidebar, no dashboard. Everything the
 * product needs beyond that is either inside the composer (what to build) or appears in the thread
 * when it becomes relevant (the bot, then the preview).
 *
 * The preview is a *contextual workspace attached to the conversation*, never a destination: it
 * opens beside the transcript on a wide screen and takes the screen on a narrow one, and collapsing
 * it returns here with the bot and the conversation exactly as they were. That is why the whole
 * thing lives under one runtime — the chat and the bot are the same session, not two pages.
 */
const BotBuilder: React.FC = () => {
  const { isPreviewOpen, artifact } = useWorkspace();

  return (
    <BotBuilderRuntime>
      <div className="flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <Thread />
        </div>

        {isPreviewOpen && artifact && (
          <div className="fixed inset-0 z-30 lg:static lg:z-auto lg:w-[min(40rem,42%)] lg:shrink-0">
            <BotPreviewPanel />
          </div>
        )}
      </div>
    </BotBuilderRuntime>
  );
};

export const ChatWorkspace: React.FC = () => <BotBuilder />;