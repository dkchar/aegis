import { Handle, Position } from "@xyflow/react";
import { GitBranch, ScrollText } from "lucide-react";
import { memo } from "react";
import { StatusBadge } from "./components/aegis.jsx";
import { cn } from "./components/ui/index.js";

const handleStyle = {
  background: "transparent",
  border: 0,
  height: 1,
  width: 1,
};

/** Shared node chrome: a lane-colored accent rail, selection ring, and fixed width. */
function NodeFrame({ kind, id, selected, color, width, children }) {
  return (
    <div
      data-chronos-node={kind}
      data-node-id={id}
      data-selected={selected || undefined}
      className={cn(
        "relative overflow-hidden rounded-md border bg-surface py-2 pl-3.5 pr-3 text-foreground shadow-sm transition-colors",
        selected ? "bg-surface-raised" : "border-border-strong hover:bg-surface-raised",
      )}
      style={{ width, borderColor: selected ? color : undefined, boxShadow: selected ? `0 0 0 1px ${color}` : undefined }}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} aria-hidden="true" />
      {children}
    </div>
  );
}

export const TimelineNode = memo(function TimelineNode({ data }) {
  const event = data.event;
  return (
    <NodeFrame kind="timeline" id={event.id} selected={data.selected} color={data.color} width={420}>
      <FlowHandles color={data.color} orientation={data.orientation} />
      <div className="flex min-w-0 items-center gap-2">
        <ScrollText className="size-3.5 shrink-0" style={{ color: data.color }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{event.title}</span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-subtle-foreground">{event.lane}</span>
        <StatusBadge status={event.status} variant="dot" />
      </div>
      <NodeDetails selected={data.selected}>
        <DetailLine label={event.issue || data.lane} value={event.detail || event.source} />
      </NodeDetails>
    </NodeFrame>
  );
});

export const MergeNode = memo(function MergeNode({ data }) {
  const ticket = data.ticket;
  return (
    <NodeFrame kind="tree" id={ticket.id} selected={data.selected} color={data.color} width={300}>
      <FlowHandles color={data.color} orientation={data.orientation} />
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="size-3.5 shrink-0" style={{ color: data.color }} aria-hidden="true" />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ticket.id}</span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-subtle-foreground">{ticket.kind}</span>
        <StatusBadge status={ticket.column} variant="dot" className="ml-auto" />
      </div>
      <p className="mt-1 truncate text-[13px] font-medium">{ticket.title}</p>
      <NodeDetails selected={data.selected}>
        <DetailLine label="scope" value={ticket.scope?.join(", ") || "none"} />
        <DetailLine label="blocked by" value={ticket.blockedBy?.join(", ") || "none"} />
      </NodeDetails>
    </NodeFrame>
  );
});

export const ArtifactNode = TimelineNode;

function FlowHandles({ color, orientation }) {
  const target = orientation === "horizontal" ? Position.Left : Position.Top;
  const source = orientation === "horizontal" ? Position.Right : Position.Bottom;
  return (
    <>
      <Handle type="target" position={target} style={{ ...handleStyle, background: color }} />
      <Handle type="source" position={source} style={{ ...handleStyle, background: color }} />
    </>
  );
}

function NodeDetails({ selected, children }) {
  if (!selected) return null;
  return <div className="mt-2 grid gap-1 border-t border-border pt-2">{children}</div>;
}

function DetailLine({ label, value }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 text-xs">
      <span className="font-mono text-[10px] uppercase tracking-wide text-subtle-foreground">{label}</span>
      <span className="line-clamp-2 break-all text-muted-foreground">{value}</span>
    </div>
  );
}
