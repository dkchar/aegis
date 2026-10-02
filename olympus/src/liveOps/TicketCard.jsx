import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { CasteIcon, resolveCaste } from "../components/aegis.jsx";
import { Badge, Select, cn } from "../components/ui/index.js";
import { columnLabels } from "../state.js";
import { TicketEditor } from "./TicketForms.jsx";

export function TicketCard({ ticket, state, mutate, columnOptions, moveTicket }) {
  const isEditing = state.editingTicketId === ticket.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <motion.article
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: isDragging ? 0.4 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={cn(
        "grid min-w-0 gap-2 rounded-md border border-border bg-surface p-2.5 shadow-xs transition-[border-color] hover:border-border-strong",
        !isEditing && "cursor-grab active:cursor-grabbing",
      )}
      {...attributes}
      {...(!isEditing ? listeners : {})}
    >
      {isEditing ? (
        <TicketEditor ticket={ticket} state={state} mutate={mutate} columnOptions={columnOptions} />
      ) : (
        <TicketPreview ticket={ticket}>
          <MoveSelect ticket={ticket} state={state} mutate={mutate} columnOptions={columnOptions} moveTicket={moveTicket} />
        </TicketPreview>
      )}
    </motion.article>
  );
}

/** Card body shared by the board and the drag overlay. */
export function TicketPreview({ ticket, overlay = false, children = null }) {
  const trackerColumn = ticket.trackerColumn ?? ticket.column;
  const projected = ticket.runtimeStage && trackerColumn !== ticket.column;
  const caste = ticket.runtimeAgent?.caste;
  return (
    <div className={cn("grid min-w-0 gap-2", overlay && "w-72 max-w-[calc(100vw-2rem)] rounded-md border border-primary/40 bg-surface-raised p-2.5 shadow-elevated")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-subtle-foreground">{ticket.id}</span>
        <Badge>{ticket.kind}</Badge>
      </div>
      <h4 className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{ticket.title}</h4>
      {(projected || ticket.blockedBy.length > 0 || ticket.scope.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {caste && (
            <Badge tone={resolveCaste(caste)?.tone ?? "accent"}>
              <CasteIcon caste={caste} className="text-current" />
              {caste} · {ticket.runtimeStage}
            </Badge>
          )}
          {projected && !caste && <Badge tone="warning">{ticket.runtimeStage}</Badge>}
          {ticket.blockedBy.length > 0 && <Badge tone="danger">blocked by {ticket.blockedBy.length}</Badge>}
          {ticket.scope.length > 0 && <Badge>{ticket.scope.length} files</Badge>}
        </div>
      )}
      <details className="group/details">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-subtle-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3 transition-transform group-open/details:rotate-90" aria-hidden="true" />
          Details
        </summary>
        <div className="mt-2 grid gap-2 border-t border-border pt-2">
          {ticket.body && <p className="line-clamp-4 text-xs leading-snug text-muted-foreground">{ticket.body}</p>}
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
            <dt className="text-subtle-foreground">tracker</dt>
            <dd className="m-0">{columnLabels[trackerColumn] ?? trackerColumn}</dd>
            <dt className="text-subtle-foreground">scope</dt>
            <dd className="m-0 break-all font-mono">{ticket.scope.join(", ") || "none"}</dd>
            <dt className="text-subtle-foreground">labels</dt>
            <dd className="m-0 break-words">{ticket.labels.join(", ") || "none"}</dd>
            <dt className="text-subtle-foreground">blockers</dt>
            <dd className="m-0 break-words font-mono">{ticket.blockedBy.join(", ") || "none"}</dd>
            <dt className="text-subtle-foreground">lease</dt>
            <dd className="m-0 break-all font-mono">{ticket.lease.sessionId ?? "none"}</dd>
          </dl>
          {children}
        </div>
      </details>
    </div>
  );
}

function MoveSelect({ ticket, state, mutate, columnOptions, moveTicket }) {
  const trackerColumn = ticket.trackerColumn ?? ticket.column;
  const runtimeOwned = Boolean(ticket.runtimeStage && ticket.column !== trackerColumn);
  return (
    <div className="flex items-center gap-2" onPointerDown={(event) => event.stopPropagation()}>
      <span className="text-[11px] text-subtle-foreground">Move</span>
      <Select
        size="sm"
        value={trackerColumn}
        disabled={runtimeOwned}
        title={runtimeOwned ? `Runtime projection: ${ticket.runtimeStage}` : "Move ticket"}
        aria-label={`Move ${ticket.id}`}
        options={columnOptions}
        onValueChange={(column) => column && moveTicket(state, mutate, ticket.id, column)}
        className="flex-1"
      />
    </div>
  );
}
