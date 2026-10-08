import { useMemo, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AttachmentAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { ChatMessage } from '../../types/agent';

/**
 * Attachments are carried as metadata, not bytes.
 *
 * The builder turn records which files the user brought to the request; the bot's knowledge is
 * attached separately, from the workspace, once the bot exists. So an attachment is name, size and
 * type — enough for the transcript to be honest about what was shared without inventing an upload
 * the backend does not have.
 */
export interface MessageAttachment {
  name: string;
  sizeFormatted: string;
  type: string;
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const attachmentAdapter: AttachmentAdapter = {
  accept: '*/*',
  add: async ({ file }) => ({
    id: `${file.name}-${file.size}-${file.lastModified}`,
    type: 'file',
    name: file.name,
    contentType: file.type || 'application/octet-stream',
    file,
    status: { type: 'requires-action', reason: 'composer-send' },
  }),
  remove: async () => undefined,
  send: async (attachment) => ({
    id: attachment.id,
    type: 'file' as const,
    name: attachment.name,
    contentType: attachment.contentType ?? 'application/octet-stream',
    content: [{ type: 'text' as const, text: '' }],
    status: { type: 'complete' as const },
  }),
};

/** Host data a message carries that Assistant UI does not model. */
export interface ChatMessageMeta {
  isStreaming: boolean;
  attachments: MessageAttachment[];
  failed: boolean;
  feedback: 'good' | 'bad' | null;
}

/**
 * One workspace message, projected onto Assistant UI's message model.
 *
 * The projection is deliberately one-way. Assistant UI owns the conversational behaviour this
 * screen depends on — running state, message ordering, the composer's send/cancel lifecycle — while
 * the workspace keeps owning the transcript, because that is where the SSE stream and the durable
 * conversation live. Nothing here becomes a second source of truth.
 *
 * `metadata.custom` is the supported channel for host data on a runtime message, and it is what
 * lets a message show its attachments and feedback without a parallel lookup by id.
 */
export const projectMessage = (message: ChatMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.sender === 'user' ? 'user' : 'assistant',
  content: message.content,
  createdAt: new Date(message.timestamp === 'Just now' ? Date.now() : Date.parse(message.timestamp) || Date.now()),
  status:
    message.sender === 'user'
      ? { type: 'complete' }
      : message.isStreaming
        ? { type: 'running', step: null }
        : { type: 'complete' },
  metadata: {
    custom: {
      isStreaming: Boolean(message.isStreaming),
      attachments: message.attachments ?? [],
      failed: message.id.startsWith('error-'),
      feedback: message.feedback ?? null,
    } satisfies ChatMessageMeta,
  },
});

export const messageMeta = (custom: unknown): ChatMessageMeta => {
  const meta = custom as Partial<ChatMessageMeta> | undefined;
  return {
    isStreaming: Boolean(meta?.isStreaming),
    attachments: meta?.attachments ?? [],
    failed: Boolean(meta?.failed),
    feedback: meta?.feedback ?? null,
  };
};

/**
 * The runtime behind the builder conversation.
 *
 * Every capability the transcript exposes is wired to the workspace rather than reimplemented:
 * sending posts the message and opens the run stream, cancelling cancels the run server-side so a
 * stopped turn really stops, and regenerating re-sends the last request. No response is ever faked —
 * the streamed text is whatever the backend sends, which is why reading can start before the answer
 * is finished.
 */
export const BotBuilderRuntime: React.FC<{ children: ReactNode }> = ({ children }) => {
  const {
    activeConversation,
    isStreaming,
    isBuilding,
    sendMessage,
    stopStreaming,
    regenerateLastMessage,
  } = useWorkspace();

  const messages = activeConversation?.messages;
  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages: messages ?? [],
    // The thread stays "running" while a bot proposal is being applied, not only while tokens
    // arrive: that window is part of the turn, and the composer's Stop belongs to it too.
    isRunning: isStreaming || isBuilding,
    convertMessage: projectMessage,
    adapters: { attachments: attachmentAdapter },
    onNew: async ({ messages: sent }) => {
      const latest = sent[sent.length - 1];
      if (!latest) return;
      const custom = latest.metadata?.custom as { attachments?: MessageAttachment[] } | undefined;
      sendMessage(latest.content, custom?.attachments ?? []);
    },
    onCancel: async () => {
      stopStreaming();
    },
    onReload: async () => {
      regenerateLastMessage();
    },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
};

/**
 * Reads the message list as workspace messages.
 *
 * The runtime is fed from the workspace, so identity is preserved in both directions and the
 * transcript can key per-turn state (activity, feedback) by the same id the API uses.
 */
export const useChatMessages = (): ChatMessage[] => {
  const { activeConversation } = useWorkspace();
  return useMemo(() => activeConversation?.messages ?? [], [activeConversation?.messages]);
};