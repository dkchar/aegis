import { DndContext, DragOverlay, closestCorners, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Badge, Button, Group, Modal, Paper, Stack, Text } from "@mantine/core";
import { AnimatePresence } from "motion/react";
import { ListChecks, Plus } from "lucide-react";
import { moveOlympusTicket } from "../api.js";
import { SectionHead } from "../ui.jsx";
import { columnLabels, columns, hydrateOlympusState, moveTicket } from "../state.js";
import { TicketCard, TicketPreview } from "./TicketCard.jsx";
import { TicketDraftForm } from "./TicketForms.jsx";

const columnOptions = columns.map((column) => ({ value: column, label: columnLabels[column] }));

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
    <Paper component="section" withBorder radius="sm" p="md">
      <Group mb="md" justify="space-between" align="flex-start" wrap="wrap">
        <SectionHead icon={ListChecks} title="Agora Graph" detail="Tracker columns stay wide and scroll horizontally for dense boards." />
        <Button color="cyan" leftSection={<Plus size={16} />} onClick={() => setShowDialog(true)}>Add Ticket</Button>
      </Group>
      <AddTicketDialog open={showDialog} draft={draft} setDraft={setDraft} addDraft={addDraft} onClose={() => setShowDialog(false)} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event) => mutate({ ...state, activeDragId: event.active.id })}
        onDragCancel={() => mutate({ ...state, activeDragId: null })}
        onDragEnd={onDragEnd}
      >
        <div className="overflow-x-auto pb-2">
          <div className="flex min-h-[62vh] min-w-max items-stretch gap-3">
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
    </Paper>
  );
}

function KanbanColumn({ column, count, tickets, state, mutate }) {
  const { setNodeRef, isOver } = useDroppable({ id: column });

  return (
    <SortableContext id={column} items={tickets.map((ticket) => ticket.id)} strategy={verticalListSortingStrategy}>
      <Paper
        ref={setNodeRef}
        withBorder
        radius="sm"
        p="sm"
        className="grid h-[62vh] w-80 shrink-0 grid-rows-[auto_minmax(0,1fr)] gap-2 transition"
        style={{ borderColor: isOver ? "var(--mantine-color-cyan-5)" : undefined, background: isOver ? "var(--mantine-color-cyan-light)" : undefined }}
        data-column={column}
      >
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Text truncate size="xs" fw={700} tt="uppercase" c="dimmed">{columnLabels[column]}</Text>
          <Badge color="gray" variant="light" size="xs">{count}</Badge>
        </Group>
        <div className="grid min-h-0 content-start gap-1.5 overflow-y-auto pr-1">
          {tickets.length === 0 && <Paper withBorder radius="sm" p="sm" style={{ borderStyle: "dashed" }}><Text size="xs" fw={700} c="dimmed">No tickets</Text></Paper>}
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
      </Paper>
    </SortableContext>
  );
}

function AddTicketDialog({ open, draft, setDraft, addDraft, onClose }) {
  return (
    <Modal opened={open} onClose={onClose} title="Add Agora Ticket" size="xl" centered closeButtonProps={{ "aria-label": "Close dialog" }}>
      <Stack component="form" gap="md" onSubmit={addDraft}>
        <Text size="sm" c="dimmed">Create a local ticket draft with the same fields operators expect from Agora.</Text>
        <TicketDraftForm draft={draft} setDraft={setDraft} addDraft={addDraft} columnOptions={columnOptions} />
      </Stack>
    </Modal>
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
