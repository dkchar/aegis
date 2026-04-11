export const STEER_COMMAND_REFERENCE = [
  { command: "status", description: "Show current loop and queue status." },
  { command: "pause", description: "Pause dispatching new work." },
  { command: "resume", description: "Resume the paused loop." },
  { command: "focus <issue-id>", description: "Pin attention to one ready or active issue." },
  { command: "kill <agent-id>", description: "Abort one live agent session." },
] as const;
