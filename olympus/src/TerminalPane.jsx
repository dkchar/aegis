import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { formatClock } from "./components/aegis.jsx";

const ESC = "\u001b[";
const reset = `${ESC}0m`;
const tagColors = {
  tool: `${ESC}36m`,
  tool_error: `${ESC}31m`,
  error: `${ESC}31m`,
  denied: `${ESC}33m`,
  api_retry: `${ESC}33m`,
  assistant: `${ESC}0m`,
  result: `${ESC}32m`,
  final: `${ESC}32m`,
  session: `${ESC}90m`,
  status: `${ESC}90m`,
  scripted: `${ESC}90m`,
};

/** Dims timestamps (shown as local clock time) and colors `[tag]` prefixes. */
export function colorizeTerminalLine(line) {
  if (line.startsWith("$ ")) return `${ESC}96m$${reset} ${line.slice(2)}`;
  const match = /^(\d{4}-\d\d-\d\dT[\d:.]+Z )?\[([a-z_]+)\](.*)$/.exec(line);
  if (!match) return line;
  const [, timestamp = "", tag, rest] = match;
  const clock = timestamp ? `${ESC}90m${formatClock(timestamp.trim())}${reset} ` : "";
  const color = tagColors[tag] ?? `${ESC}35m`;
  return `${clock}${color}[${tag}]${reset}${tag === "tool_error" || tag === "error" ? `${ESC}31m${rest}${reset}` : rest}`;
}

export default function TerminalPane({ session }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const lastTextRef = useRef("");
  const lines = Array.isArray(session.lines) && session.lines.length > 0
    ? session.lines
    : [`$ aegis session inspect ${session.id}`, "[session] waiting for transcript"];
  const plainText = lines.join("\n");
  const terminalText = lines.map(colorizeTerminalLine).join("\r\n");

  function fitAndScroll() {
    const terminal = terminalRef.current;
    if (!terminal) return;
    try {
      fitRef.current?.fit();
      terminal.scrollToBottom();
    } catch {
      // xterm can expose fit and scroll APIs before its viewport has dimensions.
    }
  }

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: '"Geist Mono Variable", ui-monospace, SFMono-Regular, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      theme: {
        background: "#0b0c10",
        foreground: "#d9dce3",
        cursor: "#0b0c10",
        selectionBackground: "#2ed3bd44",
        black: "#0b0c10",
        brightBlack: "#6b7080",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c4b5fd",
        cyan: "#2ed3bd",
        brightCyan: "#5eead4",
        white: "#d9dce3",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitRef.current = fitAddon;
    requestAnimationFrame(fitAndScroll);
    const observer = new ResizeObserver(() => requestAnimationFrame(fitAndScroll));
    observer.observe(containerRef.current);
    lastTextRef.current = "";
    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      lastTextRef.current = "";
    };
  }, []);

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
    <div className="relative min-h-0 min-w-0 bg-terminal p-3">
      <pre className="sr-only">{plainText}</pre>
      <div ref={containerRef} className="terminal-host h-full min-h-[20rem]" aria-hidden="true" />
    </div>
  );
}
