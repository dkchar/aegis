import { Code, Paper, Stack } from "@mantine/core";
import { TerminalSquare } from "lucide-react";
import { useEffect, useRef } from "react";
import { EmptyState, SectionHead } from "./ui.jsx";

export function LogDeck({ logs, compact = false }) {
  return (
    <Paper component="section" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <SectionHead icon={TerminalSquare} title={compact ? "Live Terminal Logs" : "Logs"} detail="Operational output streams through server-sent events; no manual refresh required." />
        {logs.length === 0 ? (
          <EmptyState title="No daemon logs" detail="Daemon output starts streaming after Aegis starts." />
        ) : (
          <AutoLogPre logs={logs} compact={compact} />
        )}
      </Stack>
    </Paper>
  );
}

function AutoLogPre({ logs, compact }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [logs]);

  return (
    <Code
      component="pre"
      ref={ref}
      block
      className={`terminal-scroll ${compact ? "max-h-80 min-h-44" : "max-h-[32rem] min-h-72"} overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--mantine-color-dark-9)] p-4 font-mono text-xs leading-relaxed`}
    >
      {logs.join("\n")}
    </Code>
  );
}
