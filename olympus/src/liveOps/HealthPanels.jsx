import { Activity, HeartPulse } from "lucide-react";
import { useEffect, useRef } from "react";
import { HealthIcon } from "../Shell.jsx";
import { EmptyState, SectionCard, StatusBadge } from "../components/aegis.jsx";
import { Badge } from "../components/ui/index.js";
import { phases } from "../state.js";

export function PhaseEventBoard({ state }) {
  return (
    <SectionCard icon={Activity} title="Daemon Events" description="Phase logs per loop stage; newest events stay pinned at the bottom.">
      <div className="scroll-thin overflow-x-auto pb-1">
        <div className="grid min-w-[56rem] grid-cols-5 gap-2">
          {phases.map((phase) => (
            <PhaseEventColumn key={phase} phase={phase} events={state.loopEvents[phase] || []} />
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

function PhaseEventColumn({ phase, events }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [events]);

  return (
    <div className="grid min-h-72 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-surface-sunken">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-2">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{phase}</span>
        <Badge>{events.length}</Badge>
      </div>
      <ol ref={scrollRef} className="scroll-thin grid max-h-64 content-start gap-1.5 overflow-y-auto p-2">
        {events.length === 0 && <li className="px-1 py-2 text-xs text-subtle-foreground">Waiting for {phase} output.</li>}
        {events.map(([time, event, detail], index) => (
          <li key={`${time}-${event}-${index}`} className="grid gap-0.5 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[11px] leading-snug">
            <span className="text-subtle-foreground">{time}</span>
            <span className="text-primary">{event}</span>
            {detail && <span className="break-all text-muted-foreground">{detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HealthDeck({ state }) {
  return (
    <SectionCard icon={HeartPulse} title="Run Health" description="Readiness across tracker, state files, merge queue, artifacts, and sessions.">
      {state.healthChecks.length === 0 ? (
        <EmptyState title="No health signals" detail="Readiness checks appear after Olympus connects to an Aegis workspace." />
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-md border border-border bg-border">
          {state.healthChecks.map(([label, status, detail]) => (
            <li key={label} className="flex items-start gap-3 bg-surface px-3 py-2.5">
              <HealthIcon status={status} />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{label}</span>
                  <StatusBadge status={status} />
                </div>
                <span className="text-xs text-muted-foreground">{detail}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
