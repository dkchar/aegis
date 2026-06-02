import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Group, Paper, Text, UnstyledButton } from "@mantine/core";
import { useEffect, useRef } from "react";
import { StatusBadge } from "./ui.jsx";

export default function TerminalPane({ session, title, selected = false, compact = false, framed = true, onSelect }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const lastTextRef = useRef("");
  const terminalText = renderTerminal(session);

  function fitAndScroll() {
    const terminal = terminalRef.current;
    if (!terminal) return;
    try {
      fitRef.current?.fit();
    } catch {
      return;
    }
    try {
      terminal.scrollToBottom();
    } catch {
      // xterm can expose scroll APIs before its viewport dimensions are ready.
    }
  }

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: false,
      rows: compact ? 14 : 16,
      disableStdin: true,
      fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      theme: { background: "#05080d", foreground: "#e5edf7", cursor: "#e5edf7", green: "#4ade80", red: "#f87171" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitRef.current = fitAddon;
    requestAnimationFrame(fitAndScroll);
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(fitAndScroll);
    });
    observer.observe(containerRef.current);
    lastTextRef.current = "";
    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      lastTextRef.current = "";
    };
  }, [compact]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminalText === lastTextRef.current) return;

    const previousText = lastTextRef.current;
    if (previousText && terminalText.startsWith(previousText)) {
      terminal.write(terminalText.slice(previousText.length));
    } else {
      terminal.reset();
      terminal.write(terminalText);
    }
    requestAnimationFrame(fitAndScroll);
    lastTextRef.current = terminalText;
  }, [terminalText]);

  return (
    <Paper
      component="article"
      withBorder={framed}
      radius={framed ? "sm" : 0}
      p="sm"
      h="100%"
      className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2"
      style={{ borderColor: selected ? "var(--mantine-color-cyan-5)" : undefined }}
    >
      <UnstyledButton onClick={onSelect} w="100%">
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text truncate size="sm" fw={700}>{title}</Text>
          <StatusBadge status={session.status}>{session.status}</StatusBadge>
        </Group>
      </UnstyledButton>
      <pre className="sr-only">{terminalText}</pre>
      <div ref={containerRef} className={`terminal-host min-h-0 ${compact ? "h-80" : framed ? "h-96" : "h-full"} overflow-auto rounded-lg bg-[var(--mantine-color-dark-9)] p-2`} />
    </Paper>
  );
}

function renderTerminal(session) {
  const lines = Array.isArray(session.lines) && session.lines.length > 0
    ? session.lines
    : [`$ aegis session inspect ${session.id}`, "[adapter] waiting for transcript"];
  return lines.join("\r\n");
}
