import { describe, expect, it } from "vitest";

import { STEER_COMMAND_REFERENCE } from "../../../src/shared/steer-command-reference.js";

describe("STEER_COMMAND_REFERENCE", () => {
  it("lists the deterministic MVP steer commands", () => {
    expect(STEER_COMMAND_REFERENCE.map((entry) => entry.command)).toEqual([
      "status",
      "pause",
      "resume",
      "focus <issue-id>",
      "kill <agent-id>",
    ]);
  });
});
