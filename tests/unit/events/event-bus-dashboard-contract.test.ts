import { describe, expect, it } from "vitest";

import { getLiveEventPayloadFields } from "../../../src/events/event-bus.js";

describe("dashboard live event contract", () => {
  it("exposes the expanded loop, session, merge, and janus event fields", () => {
    expect(getLiveEventPayloadFields("loop.phase_log")).toEqual([
      "phase",
      "line",
      "level",
      "issueId",
      "agentId",
    ]);

    expect(getLiveEventPayloadFields("agent.session_started")).toEqual([
      "sessionId",
      "caste",
      "issueId",
      "stage",
      "model",
    ]);

    expect(getLiveEventPayloadFields("agent.session_ended")).toEqual([
      "sessionId",
      "caste",
      "issueId",
      "outcome",
    ]);

    expect(getLiveEventPayloadFields("merge.queue_log")).toEqual([
      "issueId",
      "status",
      "attemptCount",
    ]);

    expect(getLiveEventPayloadFields("janus.session_started")).toEqual([
      "sessionId",
      "issueId",
    ]);
  });
});
