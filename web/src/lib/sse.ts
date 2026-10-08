/**
 * Live run streaming.
 *
 * `EventSource` cannot send an `Authorization` header, so the stream is read as an SSE-formatted
 * `fetch` body instead. The framing (id/event/data, heartbeats, resume) is the backend's job; this
 * module only assembles frames and hands them to the caller.
 */

import type { RunEvent } from '../types/agent';
import { API_BASE, authHeaders } from './api';

export interface RunStreamHandlers {
  onEvent: (event: RunEvent) => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
}

export interface RunStream {
  close: () => void;
}

function parseFrame(frame: string): RunEvent | null {
  let id = '';
  let type = '';
  const dataLines: string[] = [];
  // The backend frames events with CRLF, which is valid SSE and what every browser then
  // receives. Normalising here is what makes the frames parseable at all — splitting on
  // a bare `\n\n` silently matched nothing and the UI only ever showed post-run refetches.
  for (const line of frame.replace(/\r\n/g, '\n').split('\n')) {
    if (!line || line.startsWith(':')) continue; // heartbeat comment
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'event') type = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  try {
    const payload = JSON.parse(dataLines.join('\n')) as Partial<RunEvent> & { data?: unknown };
    return {
      seq: payload.seq ?? (Number(id) || 0),
      id: payload.id ?? id,
      runId: payload.runId ?? '',
      type: type || payload.type || 'message',
      ts: payload.ts ?? new Date().toISOString(),
      data: (payload.data as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}

export function subscribeToRun(runId: string, handlers: RunStreamHandlers): RunStream {
  const controller = new AbortController();
  let closed = false;

  const close = () => {
    closed = true;
    controller.abort();
  };

  void (async () => {
    try {
      const response = await fetch(`${API_BASE}/runs/${runId}/stream`, {
        headers: { ...authHeaders(), Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`run stream failed with status ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const drain = () => {
        // A frame ends with a blank line, which may be CRLF or LF.
        let match = /\r?\n\r?\n/.exec(buffer);
        while (match) {
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const event = parseFrame(frame);
          if (event) handlers.onEvent(event);
          match = /\r?\n\r?\n/.exec(buffer);
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        drain();
      }
      // Flush the tail. Browsers may hand over a whole short-lived run in one chunk, so
      // every frame can still be sitting in the buffer when the stream ends — dropping it
      // meant a fast run delivered no events at all and the UI only ever recovered through
      // the post-run refetch.
      buffer += decoder.decode();
      drain();
      if (buffer.trim()) {
        const event = parseFrame(buffer);
        if (event) handlers.onEvent(event);
      }
    } catch (error) {
      // An abort is the caller closing the stream, not a failure.
      if (!closed) handlers.onError?.(error);
    } finally {
      handlers.onClose?.();
    }
  })();

  return { close };
}
