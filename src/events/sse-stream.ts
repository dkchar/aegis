import { HTTP_ROUTE_PATHS } from "../server/routes.js";
import type { AegisLiveEvent, LiveEventType } from "./event-bus.js";

export const SSE_EVENT_STREAM_PATH = HTTP_ROUTE_PATHS.events;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export interface SseFrame {
  id: string;
  event: LiveEventType;
  data: string;
  retry?: number;
}

export interface SerializeLiveEventOptions {
  retry?: number;
}

export interface SseReplaySource {
  replay(afterEventId?: string | null): AegisLiveEvent[];
  subscribe(listener: (event: AegisLiveEvent) => void): () => void;
}

export interface SsePublishReplayTransport {
  replay(lastEventId?: string | null): string[];
  subscribe(writeFrame: (frame: string) => void): () => void;
}

export function formatSseFrame(frame: SseFrame): string {
  const lines: string[] = [`id: ${frame.id}`, `event: ${frame.event}`];

  if (typeof frame.retry === "number") {
    lines.push(`retry: ${frame.retry}`);
  }

  for (const line of frame.data.split(/\r?\n/)) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join("\n")}\n\n`;
}

export function serializeLiveEventForSse(
  event: AegisLiveEvent,
  options: SerializeLiveEventOptions = {},
): SseFrame {
  return {
    id: event.id,
    event: event.type,
    data: JSON.stringify(event),
    retry: options.retry,
  };
}

export function createSsePublishReplayTransport(
  source: SseReplaySource,
  options: SerializeLiveEventOptions = {},
): SsePublishReplayTransport {
  return {
    replay(lastEventId) {
      return source.replay(lastEventId).map((event) =>
        formatSseFrame(serializeLiveEventForSse(event, options)),
      );
    },
    subscribe(writeFrame) {
      return source.subscribe((event) => {
        writeFrame(formatSseFrame(serializeLiveEventForSse(event, options)));
      });
    },
  };
}
