import { AnimatePresence, motion } from "motion/react";
import { Orbit, Pause, Play, Radio, Tags, TerminalSquare, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAetherEngine, readPalette } from "./aether/engine.js";
import { STATION_BY_ID, buildAetherScene, buildSignalFeed, describeEvent } from "./aether/model.js";
import { CasteIcon, EmptyState, LiveDot, StatusBadge, formatClock } from "./components/aegis.jsx";
import { Badge, Button, Card, CardTitle, Tooltip, cn } from "./components/ui/index.js";
import { Screen } from "./Shell.jsx";

const toneDot = {
  info: "bg-info",
  primary: "bg-primary",
  violet: "bg-violet",
  warning: "bg-warning",
  danger: "bg-danger",
  success: "bg-success",
  muted: "bg-subtle-foreground",
};

const legend = [
  ["Live session", "bg-primary ring-2 ring-primary/40"],
  ["Waiting", "border border-info bg-info/25"],
  ["Rework", "border border-danger bg-danger/25"],
  ["Blocked", "bg-subtle-foreground/60"],
  ["Landed", "bg-success"],
];

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function highestSeq(events) {
  return (events ?? []).reduce((max, entry) => (Number.isFinite(entry?.seq) && entry.seq > max ? entry.seq : max), -1);
}

/**
 * Aether: the live swarm. Tickets fly between caste stations as their stage
 * changes, sessions pulse and spark with adapter activity, and typed handoffs
 * travel the routes as packets the moment the loop logs them.
 */
export default function Aether({ state, theme = "dark" }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const lastSeqRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [showAllLabels, setShowAllLabels] = useState(false);
  const [hover, setHover] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const scene = useMemo(
    () => buildAetherScene(state),
    [state.tickets, state.dispatchRecords, state.agents],
  );
  const signals = useMemo(() => buildSignalFeed(state.events), [state.events]);
  const selected = scene.motes.find((mote) => mote.id === selectedId) ?? null;
  const daemonLive = state.daemon?.status === "running";

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return undefined;
    const engine = createAetherEngine(canvas, { reducedMotion: prefersReducedMotion() });
    engineRef.current = engine;
    const fit = () => {
      const bounds = container.getBoundingClientRect();
      engine.resize(bounds.width, bounds.height);
    };
    fit();
    engine.setPalette(readPalette());
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    engine.start();
    return () => {
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // The theme attribute lands in a parent effect; read tokens on the next frame.
  useEffect(() => {
    const handle = requestAnimationFrame(() => engineRef.current?.setPalette(readPalette()));
    return () => cancelAnimationFrame(handle);
  }, [theme]);

  useEffect(() => {
    engineRef.current?.setScene(scene);
  }, [scene]);

  // Only events appended after the view opened play effects; history stays in the feed.
  useEffect(() => {
    const latest = highestSeq(state.events);
    if (lastSeqRef.current === null || latest < lastSeqRef.current) {
      lastSeqRef.current = latest;
      return;
    }
    for (const entry of state.events ?? []) {
      if (entry.seq > lastSeqRef.current) engineRef.current?.trigger(describeEvent(entry));
    }
    lastSeqRef.current = latest;
  }, [state.events]);

  useEffect(() => engineRef.current?.setPaused(paused), [paused]);
  useEffect(() => engineRef.current?.setShowAllLabels(showAllLabels), [showAllLabels]);
  useEffect(() => engineRef.current?.setSelected(selected ? selected.id : null), [selected]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSelectedId("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function pointerTarget(event) {
    const bounds = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    return { x, y, id: engineRef.current?.hitTest(x, y) ?? null };
  }

  function onPointerMove(event) {
    const target = pointerTarget(event);
    engineRef.current?.setHovered(target.id);
    // Moving over empty space must not re-render the view on every event.
    setHover((current) => (target.id ? target : current === null ? current : null));
  }

  function onPointerLeave() {
    engineRef.current?.setHovered(null);
    setHover(null);
  }

  // The tooltip names the ticket a click selects, even if it drifted a little.
  function onClick(event) {
    setSelectedId(pointerTarget(event).id ?? hover?.id ?? "");
  }

  const selectSignal = useCallback((issueId) => {
    if (issueId) setSelectedId(issueId);
  }, []);
  const hoveredMote = hover ? scene.motes.find((mote) => mote.id === hover.id) : null;
  const summary = `Swarm map: ${scene.totals.inFlight} tickets in flight, ${scene.totals.running} live sessions, ${scene.totals.done} of ${scene.totals.tickets} landed, ${scene.totals.attention} need attention.`;

  return (
    <Screen className="xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="relative overflow-hidden">
        <div ref={containerRef} className="relative h-[calc(100dvh-15.5rem)] min-h-[560px] bg-surface-sunken/70 max-sm:h-[980px]">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={summary}
            className={cn("absolute inset-0 touch-none", hoveredMote ? "cursor-pointer" : "cursor-default")}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onClick={onClick}
          />

          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Orbit className="size-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold tracking-tight text-foreground">Aether</h2>
                <span className="text-xs text-muted-foreground">live swarm</span>
                <LiveDot tone={daemonLive ? "success" : "neutral"} live={daemonLive} />
              </div>
              <dl className="flex flex-wrap gap-1.5">
                <HudStat label="In flight" value={scene.totals.inFlight} />
                <HudStat label="Live sessions" value={scene.totals.running} tone="text-primary" />
                <HudStat label="Landed" value={`${scene.totals.done}/${scene.totals.tickets}`} tone="text-success" />
                <HudStat label="Blocked" value={scene.totals.blocked} tone={scene.totals.blocked ? "text-warning" : undefined} />
                <HudStat label="Attention" value={scene.totals.attention} tone={scene.totals.attention ? "text-danger" : undefined} />
              </dl>
            </div>
            <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-border bg-surface/80 p-0.5 backdrop-blur">
              <Tooltip content={paused ? "Resume animation" : "Pause animation"}>
                <Button variant="ghost" size="icon-sm" aria-label={paused ? "Resume animation" : "Pause animation"} aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
                  {paused ? <Play /> : <Pause />}
                </Button>
              </Tooltip>
              <Tooltip content={showAllLabels ? "Label live and failed tickets only" : "Label every ticket"}>
                <Button variant="ghost" size="icon-sm" aria-label="Label every ticket" aria-pressed={showAllLabels} onClick={() => setShowAllLabels((value) => !value)} className={cn(showAllLabels && "bg-surface-raised text-foreground")}>
                  <Tags />
                </Button>
              </Tooltip>
            </div>
          </div>

          {scene.motes.length === 0 && (
            <div className="absolute inset-0 grid place-items-center p-6">
              <EmptyState
                icon={Orbit}
                title="No work in the swarm"
                detail="Select an initialized Aegis workspace with Agora tickets, or start the daemon from the terminal."
                className="bg-surface/80 backdrop-blur"
              />
            </div>
          )}

          {hoveredMote && hoveredMote.id !== selectedId && (
            <div
              className="pointer-events-none absolute z-10 grid max-w-64 gap-0.5 rounded-md border border-border bg-surface/95 px-2.5 py-1.5 shadow-elevated backdrop-blur"
              style={{ left: Math.min(hover.x + 14, (containerRef.current?.clientWidth ?? 0) - 260), top: hover.y + 14 }}
            >
              <span className="font-mono text-[11px] text-muted-foreground">{hoveredMote.id} · {STATION_BY_ID[hoveredMote.station].label}</span>
              <span className="text-xs font-medium leading-snug text-foreground">{hoveredMote.title}</span>
            </div>
          )}

          <AnimatePresence>
            {selected && <MoteDetail key={selected.id} mote={selected} onClose={() => setSelectedId("")} />}
          </AnimatePresence>

          <ul className="pointer-events-none absolute bottom-3 right-4 flex flex-wrap justify-end gap-x-3 gap-y-1" aria-label="Aether legend">
            {legend.map(([label, swatch]) => (
              <li key={label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={cn("size-2 rounded-full", swatch)} aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <SignalFeed signals={signals} live={daemonLive} onSelect={selectSignal} />
    </Screen>
  );
}

function HudStat({ label, value, tone }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-md border border-border bg-surface/75 px-2 py-1 backdrop-blur">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("m-0 font-mono text-xs font-semibold tabular-nums text-foreground", tone)}>{value}</dd>
    </div>
  );
}

function MoteDetail({ mote, onClose }) {
  const station = STATION_BY_ID[mote.station];
  return (
    <motion.aside
      aria-label={`${mote.id} details`}
      className="absolute bottom-10 left-4 z-10 grid w-[min(24rem,calc(100%-2rem))] gap-2.5 rounded-lg border border-border bg-surface/95 p-3.5 shadow-elevated backdrop-blur"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="font-mono text-[11px] text-muted-foreground">{mote.id} · {station.label}</span>
          <h3 className="text-sm font-semibold leading-snug text-foreground">{mote.title}</h3>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={mote.stage} />
        {mote.caste && (
          <Badge className="gap-1">
            <CasteIcon caste={mote.caste} />
            {mote.caste}
          </Badge>
        )}
        {mote.failures > 0 && <Badge tone="danger">{mote.failures} failure{mote.failures === 1 ? "" : "s"}</Badge>}
        {mote.scope.length > 0 && <Badge>{mote.scope.length} file{mote.scope.length === 1 ? "" : "s"} in scope</Badge>}
      </div>
      {mote.activity && (
        <p className="truncate rounded-md bg-terminal px-2 py-1.5 font-mono text-[11px] text-terminal-foreground" title={mote.activity}>
          {mote.activity}
        </p>
      )}
      {mote.blockedBy.length > 0 && (
        <p className="text-xs text-muted-foreground">Blocked by <span className="font-mono text-foreground">{mote.blockedBy.join(", ")}</span></p>
      )}
      {mote.sessionId && (
        <Button asChild variant="secondary" size="sm" className="justify-self-start">
          <a href={`#agents/${encodeURIComponent(mote.sessionId)}`}>
            <TerminalSquare aria-hidden="true" />
            Open session terminal
          </a>
        </Button>
      )}
    </motion.aside>
  );
}

/** The message layer: typed handoffs and loop events, newest first. */
const SignalFeed = memo(function SignalFeed({ signals, live, onSelect }) {
  return (
    <Card className="flex max-h-[calc(100dvh-15.5rem)] min-h-[560px] flex-col overflow-hidden">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <CardTitle icon={Radio}>Signals</CardTitle>
        <div className="flex items-center gap-2">
          <Badge className="font-mono">{signals.length}</Badge>
          <LiveDot tone={live ? "success" : "neutral"} live={live} label={live ? "Streaming loop events" : "Daemon stopped"} />
        </div>
      </div>
      <p className="border-b border-border bg-surface-sunken/50 px-4 py-2 text-[11px] leading-snug text-muted-foreground">
        Typed handoffs between castes and loop outcomes, as Aegis logs them. Select one to find its ticket.
      </p>
      {signals.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={Radio} title="No signals yet" detail="Handoffs appear here as the daemon logs them." />
        </div>
      ) : (
        <ol className="scroll-thin grid flex-1 content-start gap-1 overflow-y-auto p-2" aria-label="Signals, newest first">
          <AnimatePresence initial={false}>
            {signals.map((signal) => (
              <motion.li
                key={signal.seq}
                layout="position"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(signal.issueId)}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className={cn("mt-1.5 size-2 rounded-full", toneDot[signal.tone] ?? toneDot.muted)} aria-hidden="true" />
                  <span className="text-[13px] leading-snug text-foreground">{signal.text}</span>
                  <time className="mt-0.5 font-mono text-[11px] text-subtle-foreground" dateTime={signal.timestamp}>{formatClock(signal.timestamp)}</time>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </Card>
  );
});
