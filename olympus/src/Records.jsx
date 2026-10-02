import { AlertTriangle, Boxes, ChevronRight, FileJson, GitMerge } from "lucide-react";
import { CasteIcon, EmptyState, SectionCard, StatusBadge } from "./components/aegis.jsx";
import { Alert, Badge, CodeBlock, cn } from "./components/ui/index.js";
import { LogDeck } from "./LogDeck.jsx";
import { Screen } from "./Shell.jsx";
import { toggleArtifact } from "./state.js";
import { dispatchNote, dispatchRefs, dispatchStatus } from "./supervisionModel.js";

export default function Records({ state, mutate }) {
  const ticketsById = new Map(state.tickets.map((ticket) => [ticket.id, ticket]));
  const dispatchRows = state.dispatchRecords.map((record) => {
    const ticket = ticketsById.get(record.issueId);
    return {
      id: record.issueId,
      title: ticket?.title ?? record.issueId,
      stage: record.stage ?? "pending",
      status: dispatchStatus(record),
      agent: record.runningAgent?.sessionId ?? record.lastCompletedCaste ?? "none",
      caste: record.runningAgent?.caste ?? record.lastCompletedCaste ?? "",
      scope: record.fileScope?.files?.join(", ") || ticket?.scope?.join(", ") || "workspace",
      note: dispatchNote(record),
      refs: dispatchRefs(record).length,
    };
  });
  const attentionRows = dispatchRows.filter((row) => ["failed", "cooldown", "reworking"].includes(row.status));
  const attentionIssueIds = new Set(attentionRows.map((row) => row.id));
  const artifactAttention = state.artifacts.filter((artifact) =>
    ["failed", "blocked"].includes(artifact.status) && !attentionIssueIds.has(artifact.issue)
  );
  const dispatchIssueIds = new Set(dispatchRows.map((row) => row.id));
  const ticketAttention = state.tickets
    .filter((ticket) => !dispatchIssueIds.has(ticket.id) && ticket.column === "halted")
    .map((ticket) => ({
      id: ticket.id,
      status: "failed",
      stage: ticket.column,
      note: ticket.blockedBy.length ? `Waiting on ${ticket.blockedBy.join(", ")}` : ticket.body,
      agent: "tracker",
    }));
  const mergeFailures = state.mergeQueue
    .filter((item) => item.state === "failed" || item.state === "error")
    .map((item) => ({
      id: item.id,
      status: "failed",
      stage: "merge",
      note: item.note,
      agent: item.issue,
    }));
  const allAttentionRows = [...attentionRows, ...ticketAttention, ...mergeFailures];

  return (
    <Screen>
      <AttentionCard rows={allAttentionRows} artifacts={artifactAttention} />
      <DispatchProgress rows={dispatchRows} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <MergeQueue items={state.mergeQueue} />
        <Artifacts state={state} mutate={mutate} />
      </div>
      <LogDeck logs={state.logs} />
    </Screen>
  );
}

function AttentionCard({ rows, artifacts }) {
  const count = rows.length + artifacts.length;
  return (
    <SectionCard
      icon={AlertTriangle}
      title="Attention"
      description="Provider failures, exhausted work, and rejected artifacts stay visible here until the run recovers."
      actions={<Badge tone={count ? "danger" : "success"} variant="dot">{count ? `${count} open` : "all clear"}</Badge>}
    >
      {count === 0 ? (
        <p className="text-[13px] text-muted-foreground">No attention items. Provider failures, exhausted work, and rejected artifacts appear here.</p>
      ) : (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {rows.map((row) => (
            <Alert key={`${row.stage}-${row.id}`} tone={row.status === "failed" ? "danger" : "warning"} role="alert" title={<span className="font-mono">{row.id}</span>}>
              <span className="mb-1.5 flex flex-wrap gap-1.5">
                <StatusBadge status={row.status} />
                <Badge className="font-mono">{row.stage}</Badge>
              </span>
              <span className="block">{row.note}</span>
              <span className="mt-1 block break-all font-mono text-xs text-subtle-foreground">{row.agent}</span>
            </Alert>
          ))}
          {artifacts.map((artifact) => (
            <Alert key={artifact.id} tone="danger" role="alert" title={<span className="font-mono">{artifact.issue || "artifact"}</span>}>
              <span className="mb-1.5 flex flex-wrap gap-1.5">
                <StatusBadge status={artifact.status} />
                <Badge>{artifact.kind}</Badge>
              </span>
              <span className="block">{artifact.summary}</span>
              <span className="mt-1 block break-all font-mono text-xs text-subtle-foreground">{artifact.path}</span>
            </Alert>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

const headCell = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-subtle-foreground first:pl-4 last:pr-4";
const bodyCell = "px-3 py-2.5 align-top first:pl-4 last:pr-4";

function DataTable({ head, children, label }) {
  return (
    <div className="scroll-thin -mx-4 -mb-4 overflow-x-auto border-t border-border">
      <table className="w-full min-w-[40rem] border-collapse text-[13px]" aria-label={label}>
        <thead className="bg-surface-sunken/60">
          <tr>{head.map((cell) => <th key={cell} scope="col" className={headCell}>{cell}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

function DispatchProgress({ rows }) {
  return (
    <SectionCard
      icon={Boxes}
      title="Dispatch Progress"
      description="Durable state per issue from .aegis/dispatch-state.json, with session ownership and artifact references."
      actions={<Badge className="font-mono">{rows.length} records</Badge>}
    >
      {rows.length === 0 ? (
        <EmptyState icon={Boxes} title="No dispatch records" detail="Dispatch state fills after tickets enter the Aegis loop." />
      ) : (
        <DataTable label="Dispatch Progress" head={["Issue", "Status", "Stage", "Owner", "Note", "Refs"]}>
          {rows.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-surface-raised/50">
              <td className={cn(bodyCell, "max-w-[18rem]")}>
                <div className="font-mono text-xs text-muted-foreground">{row.id}</div>
                <div className="truncate font-medium" title={row.title}>{row.title}</div>
              </td>
              <td className={bodyCell}><StatusBadge status={row.status} /></td>
              <td className={cn(bodyCell, "whitespace-nowrap font-mono text-xs text-muted-foreground")}>{row.stage}</td>
              <td className={cn(bodyCell, "whitespace-nowrap")}>
                {row.caste ? (
                  <span className="inline-flex items-center gap-1.5 capitalize"><CasteIcon caste={row.caste} />{row.caste}</span>
                ) : (
                  <span className="text-subtle-foreground">—</span>
                )}
              </td>
              <td className={cn(bodyCell, "min-w-[14rem] text-xs text-muted-foreground")}>
                <div className="line-clamp-2 max-w-[36rem] break-all">{row.note}</div>
                <div className="mt-0.5 max-w-[36rem] truncate font-mono text-[11px] text-subtle-foreground" title={row.scope}>{row.scope}</div>
              </td>
              <td className={cn(bodyCell, "text-right font-mono text-xs tabular-nums text-muted-foreground")}>{row.refs}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </SectionCard>
  );
}

function MergeQueue({ items }) {
  return (
    <SectionCard
      icon={GitMerge}
      title="Merge Queue"
      description="Integration records from .aegis/merge-queue.json with tier and failure reasons."
      actions={<Badge className="font-mono">{items.length} items</Badge>}
    >
      {items.length === 0 ? (
        <EmptyState icon={GitMerge} title="Merge queue empty" detail="Completed implementation work appears here when it is ready for integration." />
      ) : (
        <ul className="-mx-4 -mb-4 divide-y divide-border border-t border-border">
          {items.map((item) => (
            <li key={item.id} className="grid gap-1 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-xs text-foreground" title={item.id}>{item.id}</span>
                <StatusBadge status={item.state} className="ml-auto" />
                <Badge className="font-mono">{item.priority}</Badge>
              </div>
              <p className="break-all text-xs text-muted-foreground">
                <span className="font-mono text-foreground/80">{item.issue}</span> · {item.note}
                {item.attempts > 1 && <span className="text-subtle-foreground"> · {item.attempts} attempts</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function Artifacts({ state, mutate }) {
  return (
    <SectionCard
      icon={FileJson}
      title="Artifacts"
      description="Recent caste, policy, and transcript records. Select one to inspect its JSON."
      actions={<Badge className="font-mono">{state.artifacts.length}</Badge>}
    >
      {state.artifacts.length === 0 ? (
        <EmptyState icon={FileJson} title="No artifacts yet" detail="Aegis writes caste output here as sessions complete." />
      ) : (
        <ul className="scroll-thin -mx-4 -mb-4 max-h-[36rem] divide-y divide-border overflow-y-auto border-t border-border">
          {state.artifacts.map((artifact) => {
            const expanded = state.expandedArtifactIds.includes(artifact.id);
            return (
              <li key={artifact.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => mutate(toggleArtifact(state, artifact.id))}
                  className="flex w-full min-w-0 items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-raised/50"
                >
                  <ChevronRight className={cn("mt-0.5 size-4 shrink-0 text-subtle-foreground transition-transform", expanded && "rotate-90")} aria-hidden="true" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <CasteIcon caste={artifact.owner} />
                      <span className="truncate text-[13px] font-medium">{artifact.issue ? `${artifact.issue} ${artifact.kind}` : artifact.kind}</span>
                    </span>
                    <span className="truncate font-mono text-[11px] text-primary/90">{artifact.path}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{artifact.summary ?? "Structured artifact available"}</span>
                  </span>
                  <StatusBadge status={artifact.status} />
                </button>
                {expanded && <CodeBlock className="mx-4 mb-3 max-h-96">{artifact.body}</CodeBlock>}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
