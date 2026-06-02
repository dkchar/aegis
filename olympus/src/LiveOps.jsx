import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Accordion, Badge, Box, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { AnimatePresence, motion } from "motion/react";
import { Activity, Boxes, CheckCircle2, FolderOpen, LayoutDashboard, ListChecks, Plus, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browseOlympusWorkspace, moveOlympusTicket, openOlympusWorkspaceFolder, switchOlympusWorkspace } from "./api.js";
import { HealthIcon, Screen } from "./Shell.jsx";
import { LogDeck } from "./LogDeck.jsx";
import { CompactSummary, EmptyState, SectionHead, StatusBadge } from "./ui.jsx";
import {
  actors,
  columnLabels,
  columns,
  hydrateOlympusState,
  kinds,
  moveTicket,
  phases,
  updateTicket,
} from "./state.js";
import { deriveOpsSummaryItems } from "./supervisionModel.js";

const columnOptions = columns.map((column) => ({ value: column, label: columnLabels[column] }));

export default function LiveOps({ state, boardTickets, counts, flow, draft, setDraft, addDraft, showDialog, setShowDialog, mutate }) {
  const summaryItems = deriveOpsSummaryItems(state, counts, flow);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <Screen>
      <CompactSummary icon={Activity} title="Ops Summary" items={summaryItems} />
      <SupervisionStrip state={state} mutate={mutate} />
      <Kanban
        state={state}
        tickets={boardTickets}
        counts={counts}
        draft={draft}
        setDraft={setDraft}
        addDraft={addDraft}
        showDialog={showDialog}
        setShowDialog={setShowDialog}
        mutate={mutate}
        sensors={sensors}
      />
      <Accordion variant="separated">
        <Accordion.Item value="health">
          <Accordion.Control>Health and phase detail</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <SimpleGrid cols={{ base: 1, xl: 2 }}>
                <PhaseEventBoard state={state} />
                <HealthDeck state={state} />
              </SimpleGrid>
              <LogDeck logs={state.logs} compact />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Screen>
  );
}

function PhaseEventBoard({ state }) {
  return (
    <Paper component="section" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <SectionHead icon={Activity} title="Daemon Events" detail="Phase logs with newest output pinned at the bottom." />
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[64rem] grid-cols-5 gap-3">
            {phases.map((phase) => (
              <PhaseEventColumn key={phase} phase={phase} events={state.loopEvents[phase] || []} />
            ))}
          </div>
        </div>
      </Stack>
    </Paper>
  );
}

function PhaseEventColumn({ phase, events }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [events]);

  return (
    <Paper withBorder radius="sm" mih={320} style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden" }}>
      <Group justify="space-between" px="sm" py="xs">
        <Text truncate ff="monospace" size="xs" fw={700} tt="uppercase">{phase}</Text>
        <Badge color="gray" variant="light" size="xs">{events.length}</Badge>
      </Group>
      <div ref={scrollRef} className="terminal-scroll grid max-h-72 content-start gap-2 overflow-y-scroll p-3 font-mono text-xs leading-relaxed">
        {events.length === 0 && (
          <Paper withBorder radius="sm" p="xs"><Text size="xs" c="dimmed">Waiting for {phase} output.</Text></Paper>
        )}
        {events.map(([time, event, detail], index) => (
          <Paper key={`${time}-${event}-${index}`} withBorder radius="sm" p="xs">
            <Stack gap={2}>
              <Text size="xs" ff="monospace" c="dimmed">{time}</Text>
              <Text size="xs" ff="monospace" c="green">{event}</Text>
              <Text size="xs" ff="monospace" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{detail}</Text>
            </Stack>
          </Paper>
        ))}
      </div>
    </Paper>
  );
}

function HealthDeck({ state }) {
  return (
    <Paper component="section" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <SectionHead icon={CheckCircle2} title="Run Health" detail="Readiness across tracker, state files, merge queue, artifacts, and sessions." />
        <Stack gap="xs">
          {state.healthChecks.length === 0 && <EmptyState title="No health signals" detail="Readiness checks appear after Olympus connects to an Aegis workspace." />}
          {state.healthChecks.map(([label, status, detail]) => (
            <Paper key={label} withBorder radius="sm" p="sm">
              <Group align="flex-start" wrap="nowrap">
                <HealthIcon status={status} />
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap="xs" wrap="wrap"><Text size="sm" fw={700} truncate>{label}</Text><StatusBadge status={status}>{status}</StatusBadge></Group>
                  <Text size="xs" c="dimmed">{detail}</Text>
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

function SupervisionStrip({ state, mutate }) {
  const [workspaceRoot, setWorkspaceRoot] = useState(state.workspace.root || "");
  const [browsing, setBrowsing] = useState(false);
  const nextAction = resolveNextAction(state);

  useEffect(() => {
    setWorkspaceRoot(state.workspace.root || "");
  }, [state.workspace.root]);

  function selectWorkspace(root) {
    switchOlympusWorkspace(root)
      .then((payload) => mutate({
        ...hydrateOlympusState(state, payload.state ?? payload),
        toast: payload.message ?? "Workspace selected",
        toastKind: "success",
      }))
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }));
  }

  function browseWorkspace() {
    setBrowsing(true);
    browseOlympusWorkspace()
      .then((payload) => {
        mutate({
          ...hydrateOlympusState(state, payload.state ?? payload),
          toast: payload.message ?? "Workspace selected",
          toastKind: payload.ok === false ? "error" : "success",
        });
      })
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }))
      .finally(() => setBrowsing(false));
  }

  function openWorkspaceFolder() {
    openOlympusWorkspaceFolder()
      .then((payload) => mutate({
        ...hydrateOlympusState(state, payload.state ?? payload),
        toast: payload.message ?? "Workspace folder opened",
        toastKind: payload.ok === false ? "error" : "success",
      }))
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }));
  }

  return (
    <Paper component="section" withBorder radius="sm" p="sm">
      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm" verticalSpacing="sm">
        <Stack gap="xs">
          <TextInput label="Workspace" value={workspaceRoot} onChange={(event) => setWorkspaceRoot(event.target.value)} placeholder="Absolute path to an initialized Aegis project" />
          <Group gap="xs" wrap="wrap">
            <Button variant="default" leftSection={<Boxes size={16} />} onClick={browseWorkspace} loading={browsing}>Browse Folder</Button>
            <Button variant="default" leftSection={<FolderOpen size={16} />} onClick={openWorkspaceFolder}>Open Folder</Button>
            <Button color="cyan" leftSection={<Boxes size={16} />} onClick={() => selectWorkspace(workspaceRoot)}>Select Workspace</Button>
            <Button variant="subtle" leftSection={<LayoutDashboard size={16} />} onClick={() => selectWorkspace("")}>Use Current Project</Button>
          </Group>
        </Stack>
        <Stack gap="xs" justify="flex-end">
          <Group gap="xs" wrap="wrap">
            <StatusBadge status={nextAction.status}>{nextAction.status}</StatusBadge>
            <Text size="sm" fw={700}>{nextAction.title}</Text>
            <Text size="xs" c="dimmed">{nextAction.detail}</Text>
          </Group>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <SupervisionFact label="Workspace" value={state.workspace.root || "current project"} />
            <SupervisionFact label="Adapter" value={state.daemon.adapter} />
            <SupervisionFact label="Events" value={state.apiStatus === "connected" ? "connected" : state.daemon.stream} />
            <SupervisionFact label="Branch" value={state.daemon.branch} />
          </SimpleGrid>
        </Stack>
      </SimpleGrid>
    </Paper>
  );
}

function SupervisionFact({ label, value }) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text>
      <Text size="xs" fw={700} ff="monospace" truncate>{value}</Text>
    </Stack>
  );
}

function resolveNextAction(state) {
  if ((state.configIssues ?? []).length > 0) {
    return {
      status: "blocked",
      title: "Finish runtime configuration",
      detail: "Start stays disabled until every required model and runtime setting is present.",
    };
  }
  if (state.configDirty) {
    return {
      status: "watch",
      title: "Save config changes",
      detail: "Persist the edited config before starting or supervising a run.",
    };
  }
  if ((state.runSummary?.running ?? false) || state.daemon.status === "running") {
    return {
      status: "running",
      title: "Watch live sessions",
      detail: "Use Sessions for terminals and Records for artifacts, merge state, and attention items.",
    };
  }
  if ((state.tickets ?? []).some((ticket) => ticket.column === "halted") || (state.runSummary?.halted ?? 0) > 0) {
    return {
      status: "failed",
      title: "Resolve halted work",
      detail: "Open Records, inspect the attention queue, then route fixes through terminal commands.",
    };
  }
  if ((state.tickets ?? []).length === 0) {
    return {
      status: "idle",
      title: "Load Agora work",
      detail: "Initialize the project and create tracker work from the terminal before starting Aegis.",
    };
  }
  return {
    status: "ready",
    title: "Start Aegis",
    detail: "Tracker work is loaded and the selected workspace is ready for daemon supervision.",
  };
}

function Kanban({ state, tickets, counts, draft, setDraft, addDraft, showDialog, setShowDialog, mutate, sensors }) {
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
            {columns.map((column) => {
              const columnTickets = tickets.filter((ticket) => ticket.column === column);
              return <KanbanColumn key={column} column={column} count={counts[column] || 0} tickets={columnTickets} state={state} mutate={mutate} />;
            })}
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
              <TicketCard key={ticket.id} ticket={ticket} state={state} mutate={mutate} />
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
      <Stack gap="md">
        <Text size="sm" c="dimmed">Create a local ticket draft with the same fields operators expect from Agora.</Text>
        <TicketDraftForm draft={draft} setDraft={setDraft} addDraft={addDraft} />
      </Stack>
    </Modal>
  );
}

function TicketDraftForm({ draft, setDraft, addDraft }) {
  return (
    <Paper component="form" withBorder radius="sm" p="sm" className="grid w-full min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={addDraft}>
      <Field label="Title" wide>
        <TextInput name="title" value={draft.title} placeholder="New ticket title" onChange={(event) => setDraft({ ...draft, title: event.target.value })} required />
      </Field>
      <Field label="Body" wide>
        <Textarea name="body" value={draft.body} placeholder="Ticket body" onChange={(event) => setDraft({ ...draft, body: event.target.value })} autosize minRows={3} />
      </Field>
      <Field label="Kind">
        <Select name="kind" value={draft.kind} data={kinds} onChange={(kind) => setDraft({ ...draft, kind: kind ?? "" })} />
      </Field>
      <Field label="Column">
        <Select name="column" value={draft.column} data={columnOptions} onChange={(column) => setDraft({ ...draft, column: column ?? "" })} />
      </Field>
      <Field label="Sprint">
        <TextInput name="sprint" value={draft.sprint} onChange={(event) => setDraft({ ...draft, sprint: event.target.value })} />
      </Field>
      <Field label="Phase">
        <TextInput name="phase" value={draft.phase} onChange={(event) => setDraft({ ...draft, phase: event.target.value })} />
      </Field>
      <Field label="Parent">
        <TextInput name="parent" value={draft.parent} placeholder="AG-0001" onChange={(event) => setDraft({ ...draft, parent: event.target.value })} />
      </Field>
      <Field label="Scope" wide>
        <TextInput name="scope" value={draft.scope} placeholder="src/App.tsx, tests/App.test.tsx" onChange={(event) => setDraft({ ...draft, scope: event.target.value })} />
      </Field>
      <Field label="Labels">
        <TextInput name="labels" value={draft.labels} placeholder="ui, backend" onChange={(event) => setDraft({ ...draft, labels: event.target.value })} />
      </Field>
      <Field label="Blocked By">
        <TextInput name="blockedBy" value={draft.blockedBy} placeholder="AG-0002" onChange={(event) => setDraft({ ...draft, blockedBy: event.target.value })} />
      </Field>
      <Field label="Created By">
        <Select name="createdBy" value={draft.actor} data={actors} onChange={(actor) => setDraft({ ...draft, actor: actor ?? "" })} />
      </Field>
      <Button className="self-end" color="cyan" leftSection={<Plus size={16} />} type="submit">Add Ticket</Button>
    </Paper>
  );
}

function Field({ label, wide = false, children }) {
  return (
    <Stack component="label" gap={4} className={wide ? "md:col-span-2" : ""}>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text>
      {children}
    </Stack>
  );
}

function TicketCard({ ticket, state, mutate }) {
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
      {isEditing ? <TicketEditor ticket={ticket} state={state} mutate={mutate} /> : <TicketSummary ticket={ticket} state={state} mutate={mutate} />}
    </Paper>
  );
}

function TicketSummary({ ticket, state, mutate }) {
  return (
    <TicketPreview ticket={ticket}>
      <div className="grid min-w-0 pt-1">
        <MoveSelect ticket={ticket} state={state} mutate={mutate} />
      </div>
    </TicketPreview>
  );
}

function TicketPreview({ ticket, overlay = false, children = null }) {
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

function TicketEditor({ ticket, state, mutate }) {
  const [local, setLocal] = useState(ticketToForm(ticket));

  function update(field, value) {
    setLocal({ ...local, [field]: value });
  }

  return (
    <form
      className="grid min-w-0 grid-cols-1 gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({ ...updateTicket(state, ticket.id, formToPatch(local)), editingTicketId: null });
      }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <strong className="truncate font-mono">{ticket.id}</strong>
        <Badge color="gray" variant="light">{ticket.kind}</Badge>
      </div>
      <Field label="Title">
        <TextInput name="title" value={local.title} onChange={(event) => update("title", event.target.value)} />
      </Field>
      <Field label="Body">
        <Textarea name="body" value={local.body} onChange={(event) => update("body", event.target.value)} autosize minRows={3} />
      </Field>
      <Field label="Kind">
        <Select name="kind" value={local.kind} data={kinds} onChange={(kind) => update("kind", kind ?? "")} />
      </Field>
      <Field label="Column">
        <Select name="column" value={local.column} data={columnOptions} onChange={(column) => update("column", column ?? "")} />
      </Field>
      <Field label="Sprint">
        <TextInput name="sprint" value={local.sprint} onChange={(event) => update("sprint", event.target.value)} />
      </Field>
      <Field label="Phase">
        <TextInput name="phase" value={local.phase} onChange={(event) => update("phase", event.target.value)} />
      </Field>
      <Field label="Parent">
        <TextInput name="parent" value={local.parent} onChange={(event) => update("parent", event.target.value)} />
      </Field>
      <Field label="Scope">
        <TextInput name="scope" value={local.scope} onChange={(event) => update("scope", event.target.value)} />
      </Field>
      <Field label="Labels">
        <TextInput name="labels" value={local.labels} onChange={(event) => update("labels", event.target.value)} />
      </Field>
      <Field label="Blocked By">
        <TextInput name="blockedBy" value={local.blockedBy} onChange={(event) => update("blockedBy", event.target.value)} />
      </Field>
      <Field label="Created By">
        <Select name="createdBy" value={local.createdBy} data={actors} onChange={(actor) => update("createdBy", actor ?? "")} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button color="cyan" leftSection={<Save size={15} />}>Save</Button>
        <Button variant="default" type="button" onClick={() => mutate({ ...state, editingTicketId: null })}>Cancel</Button>
      </div>
    </form>
  );
}

function MoveSelect({ ticket, state, mutate }) {
  const trackerColumn = ticket.trackerColumn ?? ticket.column;
  const runtimeOwned = Boolean(ticket.runtimeStage && ticket.column !== trackerColumn);
  return (
    <Select
      value={trackerColumn}
      disabled={runtimeOwned}
      title={runtimeOwned ? `Runtime projection: ${ticket.runtimeStage}` : "Move ticket"}
      data={columnOptions}
      onChange={(column) => column && commitTicketMove(state, mutate, ticket.id, column)}
    />
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

function ticketToForm(ticket) {
  return {
    title: ticket.title,
    body: ticket.body,
    kind: ticket.kind,
    column: ticket.column,
    sprint: ticket.sprint ?? "",
    phase: ticket.phase ?? "",
    parent: ticket.parent ?? "",
    scope: ticket.scope.join(", "),
    labels: ticket.labels.join(", "),
    blockedBy: ticket.blockedBy.join(", "),
    createdBy: ticket.createdBy,
  };
}

function formToPatch(form) {
  return {
    title: form.title,
    body: form.body,
    kind: form.kind,
    column: form.column,
    sprint: form.sprint,
    phase: form.phase,
    parent: form.parent,
    scope: form.scope,
    labels: form.labels,
    blockedBy: form.blockedBy,
    createdBy: form.createdBy,
  };
}
