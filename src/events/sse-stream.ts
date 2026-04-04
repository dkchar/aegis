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

export function serializeLiveEventForSse(event: AegisLiveEvent): SseFrame {
  return {
    id: event.id,
    event: event.type,
    data: JSON.stringify(event.payload),
  };
}
