import { TerminalSquare } from "lucide-react";
import { useEffect, useRef } from "react";
import { EmptyState, SectionCard } from "./components/aegis.jsx";
import { CodeBlock, cn } from "./components/ui/index.js";

export function LogDeck({ logs, compact = false }) {
  return (
    <SectionCard
      icon={TerminalSquare}
      title={compact ? "Live Terminal Logs" : "Logs"}
      description="Daemon output streams over server-sent events; no refresh required."
    >
      {logs.length === 0 ? (
        <EmptyState title="No daemon logs" detail="Daemon output starts streaming after Aegis starts." />
      ) : (
        <AutoScrollLog logs={logs} compact={compact} />
      )}
    </SectionCard>
  );
}

function AutoScrollLog({ logs, compact }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [logs]);

  return (
    <CodeBlock ref={ref} className={cn(compact ? "max-h-72 min-h-40" : "max-h-[30rem] min-h-64")}>
      {logs.join("\n")}
    </CodeBlock>
  );
}
