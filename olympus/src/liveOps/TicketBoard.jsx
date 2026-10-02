import { DndContext, DragOverlay, closestCorners, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AnimatePresence } from "motion/react";
import { ListChecks, Plus } from "lucide-react";
import { moveOlympusTicket } from "../api.js";
import { SectionCard } from "../components/aegis.jsx";
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, cn } from "../components/ui/index.js";
import { columnLabels, columns, hydrateOlympusState, moveTicket } from "../state.js";
import { TicketCard, TicketPreview } from "./TicketCard.jsx";
import { TicketDraftForm } from "./TicketForms.jsx";

const columnOptions = columns.map((column) => ({ value: column, label: columnLabels[column] }));

export const columnDots = {
  backlog: "bg-subtle-foreground",
  blocked: "bg-danger",
  ready: "bg-info",
  in_progress: "bg-primary",
  in_review: "bg-violet",
  ready_to_merge: "bg-warning",
  done: "bg-success",
  halted: "bg-danger",
};

export function TicketBoard({ state, tickets, counts, draft, setDraft, addDraft, showDialog, setShowDialog, mutate, sensors }) {
  const activeTicket = tickets.find((ticket) => ticket.id === state.activeDragId);

  function onDragEnd(event) {
    const { active, over } = event;
    const overTicket = tickets.find((ticket) => ticket.id === over?.id);
    const column = columns.includes(over?.id) ? over.id : overTicket?.column;
    if (column) {
      commitTicketMove(state, mutate, active.id, column);
      return;
    }
    mutate({ ...state, activeDragId: null });
  }

  return (
    <SectionCard
      icon={ListChecks}
      title="Agora Graph"
      description="Tracker columns with live runtime projections from dispatch state. Drag a card or use Move to change its column."
      actions={<Button variant="primary" size="sm" onClick={() => setShowDialog(true)}><Plus />Add Ticket</Button>}
      bodyClassName="pt-0"
    >
      <AddTicketDialog open={showDialog} draft={draft} setDraft={setDraft} addDraft={addDraft} onClose={() => setShowDialog(false)} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event) => mutate({ ...state, activeDragId: event.active.id })}
        onDragCancel={() => mutate({ ...state, activeDragId: null })}
        onDragEnd={onDragEnd}
      >
        <div className="scroll-thin -mx-4 overflow-x-auto px-4 pb-2">
          <div className="flex min-h-[58vh] min-w-max items-stretch gap-3">
            {columns.map((column) => (
              <KanbanColumn
                key={column}
                column={column}
                count={counts[column] || 0}
                tickets={tickets.filter((ticket) => ticket.column === column)}
                state={state}
                mutate={mutate}
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>
          {activeTicket ? <TicketPreview ticket={activeTicket} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </SectionCard>
  );
}

function KanbanColumn({ column, count, tickets, state, mutate }) {
  const { setNodeRef, isOver } = useDroppable({ id: column });

  return (
    <SortableContext id={column} items={tickets.map((ticket) => ticket.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        data-column={column}
        className={cn(
          "grid h-[58vh] w-72 shrink-0 grid-rows-[auto_minmax(0,1fr)] rounded-lg border border-border bg-surface-sunken transition-colors",
          isOver && "border-primary/50 bg-primary/5",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className={cn("size-2 rounded-full", columnDots[column])} aria-hidden="true" />
          <h3 className="truncate text-xs font-medium text-foreground">{columnLabels[column]}</h3>
          <Badge className="ml-auto font-mono">{count}</Badge>
        </div>
        <div className="scroll-thin grid min-h-0 content-start gap-2 overflow-y-auto px-2 pb-2">
          {tickets.length === 0 && (
            <p className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-xs text-subtle-foreground">No tickets</p>
          )}
          <AnimatePresence initial={false}>
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                state={state}
                mutate={mutate}
                columnOptions={columnOptions}
                moveTicket={commitTicketMove}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </SortableContext>
  );
}

function AddTicketDialog({ open, draft, setDraft, addDraft, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Add Agora Ticket</DialogTitle>
          <DialogDescription>Creates a ticket in the selected workspace's Agora board with the same fields as the Agora CLI.</DialogDescription>
        </DialogHeader>
        <form onSubmit={addDraft}>
          <TicketDraftForm draft={draft} setDraft={setDraft} addDraft={addDraft} columnOptions={columnOptions} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function commitTicketMove(state, mutate, ticketId, column) {
  const optimistic = { ...moveTicket(state, ticketId, column), activeDragId: null };
  mutate(optimistic);
  moveOlympusTicket(ticketId, column)
    .then((payload) =>
      mutate({
        ...hydrateOlympusState(optimistic, payload.state ?? payload),
        toast: `${ticketId} moved`,
        toastKind: "success",
      }),
    )
    .catch((error) => mutate({ ...optimistic, toast: error.message, toastKind: "error" }));
}
