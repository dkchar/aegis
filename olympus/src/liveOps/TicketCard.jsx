import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Box, Group, Paper, Select, Stack, Text } from "@mantine/core";
import { motion } from "motion/react";
import { columnLabels } from "../state.js";
import { TicketEditor } from "./TicketForms.jsx";

export function TicketCard({ ticket, state, mutate, columnOptions, moveTicket }) {
  const isEditing = state.editingTicketId === ticket.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <Paper
      component={motion.article}
      ref={setNodeRef}
      style={style}
      withBorder
      radius="sm"
      px="xs"
      py={6}
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: isDragging ? 0.42 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={`grid min-w-0 gap-2 ${isEditing ? "" : "cursor-grab active:cursor-grabbing"}`}
      {...attributes}
      {...(!isEditing ? listeners : {})}
    >
      {isEditing ? (
        <TicketEditor ticket={ticket} state={state} mutate={mutate} columnOptions={columnOptions} />
      ) : (
        <TicketSummary ticket={ticket} state={state} mutate={mutate} columnOptions={columnOptions} moveTicket={moveTicket} />
      )}
    </Paper>
  );
}

function TicketSummary({ ticket, state, mutate, columnOptions, moveTicket }) {
  return (
    <TicketPreview ticket={ticket}>
      <div className="grid min-w-0 pt-1">
        <MoveSelect ticket={ticket} state={state} mutate={mutate} columnOptions={columnOptions} moveTicket={moveTicket} />
      </div>
    </TicketPreview>
  );
}

export function TicketPreview({ ticket, overlay = false, children = null }) {
  const trackerColumn = ticket.trackerColumn ?? ticket.column;
  const runtimeProjection = ticket.runtimeStage && trackerColumn !== ticket.column
    ? `${columnLabels[trackerColumn]} -> ${columnLabels[ticket.column]} (${ticket.runtimeStage})`
    : "";
  return (
    <Box className={`grid min-w-0 gap-1.5 ${overlay ? "w-80 max-w-[calc(100vw-2rem)]" : ""}`}>
      <Group gap="xs" wrap="nowrap">
        <Text size="xs" fw={700} ff="monospace" c="dimmed">{ticket.id}</Text>
        <Text component="h3" m={0} size="sm" fw={700} truncate>{ticket.title}</Text>
      </Group>
      <Group gap={4} wrap="wrap">
        <Badge color="gray" variant="light" size="xs">{ticket.kind}</Badge>
        {runtimeProjection && <Badge color="yellow" variant="light" size="xs">{runtimeProjection}</Badge>}
        {ticket.blockedBy.length > 0 && <Badge color="red" variant="light" size="xs">blocked {ticket.blockedBy.length}</Badge>}
        {ticket.scope.length > 0 && <Badge color="cyan" variant="light" size="xs">scope {ticket.scope.length}</Badge>}
      </Group>
      <details className="group">
        <Text component="summary" size="xs" fw={700} tt="uppercase" c="dimmed" style={{ cursor: "pointer" }}>Details</Text>
        <Paper withBorder radius="sm" p="xs" mt="xs">
          <Stack gap="xs">
            {ticket.body && <Text size="xs" c="dimmed" lineClamp={4}>{ticket.body}</Text>}
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
              <dt className="font-extrabold">scope</dt>
              <dd className="m-0 break-words">{ticket.scope.join(", ") || "none"}</dd>
              <dt className="font-extrabold">labels</dt>
              <dd className="m-0 break-words">{ticket.labels.join(", ") || "none"}</dd>
              <dt className="font-extrabold">blockers</dt>
              <dd className="m-0 break-words">{ticket.blockedBy.join(", ") || "none"}</dd>
              <dt className="font-extrabold">lease</dt>
              <dd className="m-0 break-words">{ticket.lease.sessionId ?? "none"}</dd>
            </dl>
            {children}
          </Stack>
        </Paper>
      </details>
    </Box>
  );
}

function MoveSelect({ ticket, state, mutate, columnOptions, moveTicket }) {
  const trackerColumn = ticket.trackerColumn ?? ticket.column;
  const runtimeOwned = Boolean(ticket.runtimeStage && ticket.column !== trackerColumn);
  return (
    <Select
      value={trackerColumn}
      disabled={runtimeOwned}
      title={runtimeOwned ? `Runtime projection: ${ticket.runtimeStage}` : "Move ticket"}
      data={columnOptions}
      onChange={(column) => column && moveTicket(state, mutate, ticket.id, column)}
    />
  );
}
