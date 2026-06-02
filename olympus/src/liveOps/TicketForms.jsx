import { Badge, Button, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { Save } from "lucide-react";
import { useState } from "react";
import { actors, kinds, updateTicket } from "../state.js";

export function Field({ label, wide = false, children }) {
  return (
    <Stack component="label" gap={4} className={wide ? "md:col-span-2" : ""}>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text>
      {children}
    </Stack>
  );
}

export function TicketDraftForm({ draft, setDraft, addDraft, columnOptions }) {
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
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
      <Button className="self-end" color="cyan" type="submit">Add Ticket</Button>
    </div>
  );
}

export function TicketEditor({ ticket, state, mutate, columnOptions }) {
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
