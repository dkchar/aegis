import { Plus, Save } from "lucide-react";
import { Badge, Button, Field, Input, Select, Textarea } from "../components/ui/index.js";
import { useState } from "react";
import { actors, kinds, updateTicket } from "../state.js";

export function TicketDraftForm({ draft, setDraft, columnOptions }) {
  const set = (field) => (value) => setDraft({ ...draft, [field]: value });
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      <Field label="Title" className="md:col-span-2">
        <Input name="title" value={draft.title} placeholder="New ticket title" onChange={(event) => set("title")(event.target.value)} required />
      </Field>
      <Field label="Kind">
        <Select name="kind" value={draft.kind} options={kinds} onValueChange={(kind) => set("kind")(kind ?? "")} />
      </Field>
      <Field label="Column">
        <Select name="column" value={draft.column} options={columnOptions} onValueChange={(column) => set("column")(column ?? "")} />
      </Field>
      <Field label="Body" className="md:col-span-2 lg:col-span-4">
        <Textarea name="body" value={draft.body} placeholder="What should be built, and how will we know it works?" onChange={(event) => set("body")(event.target.value)} minRows={3} />
      </Field>
      <Field label="Scope" hint="Comma-separated files the ticket owns" className="md:col-span-2">
        <Input name="scope" value={draft.scope} placeholder="src/App.tsx, tests/App.test.tsx" onChange={(event) => set("scope")(event.target.value)} className="font-mono text-xs" />
      </Field>
      <Field label="Blocked By">
        <Input name="blockedBy" value={draft.blockedBy} placeholder="AG-0002" onChange={(event) => set("blockedBy")(event.target.value)} className="font-mono text-xs" />
      </Field>
      <Field label="Parent">
        <Input name="parent" value={draft.parent} placeholder="AG-0001" onChange={(event) => set("parent")(event.target.value)} className="font-mono text-xs" />
      </Field>
      <Field label="Labels">
        <Input name="labels" value={draft.labels} placeholder="ui, backend" onChange={(event) => set("labels")(event.target.value)} />
      </Field>
      <Field label="Sprint">
        <Input name="sprint" value={draft.sprint} onChange={(event) => set("sprint")(event.target.value)} />
      </Field>
      <Field label="Phase">
        <Input name="phase" value={draft.phase} onChange={(event) => set("phase")(event.target.value)} />
      </Field>
      <Field label="Created By">
        <Select name="createdBy" value={draft.actor} options={actors} onValueChange={(actor) => set("actor")(actor ?? "")} />
      </Field>
      <div className="flex justify-end md:col-span-2 lg:col-span-4">
        <Button variant="primary" type="submit"><Plus />Add Ticket</Button>
      </div>
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
      className="grid min-w-0 grid-cols-1 gap-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({ ...updateTicket(state, ticket.id, formToPatch(local)), editingTicketId: null });
      }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <strong className="truncate font-mono text-xs">{ticket.id}</strong>
        <Badge>{ticket.kind}</Badge>
      </div>
      <Field label="Title">
        <Input name="title" value={local.title} onChange={(event) => update("title", event.target.value)} />
      </Field>
      <Field label="Body">
        <Textarea name="body" value={local.body} onChange={(event) => update("body", event.target.value)} minRows={3} />
      </Field>
      <Field label="Kind">
        <Select name="kind" value={local.kind} options={kinds} onValueChange={(kind) => update("kind", kind ?? "")} />
      </Field>
      <Field label="Column">
        <Select name="column" value={local.column} options={columnOptions} onValueChange={(column) => update("column", column ?? "")} />
      </Field>
      <Field label="Sprint">
        <Input name="sprint" value={local.sprint} onChange={(event) => update("sprint", event.target.value)} />
      </Field>
      <Field label="Phase">
        <Input name="phase" value={local.phase} onChange={(event) => update("phase", event.target.value)} />
      </Field>
      <Field label="Parent">
        <Input name="parent" value={local.parent} onChange={(event) => update("parent", event.target.value)} />
      </Field>
      <Field label="Scope">
        <Input name="scope" value={local.scope} onChange={(event) => update("scope", event.target.value)} />
      </Field>
      <Field label="Labels">
        <Input name="labels" value={local.labels} onChange={(event) => update("labels", event.target.value)} />
      </Field>
      <Field label="Blocked By">
        <Input name="blockedBy" value={local.blockedBy} onChange={(event) => update("blockedBy", event.target.value)} />
      </Field>
      <Field label="Created By">
        <Select name="createdBy" value={local.createdBy} options={actors} onValueChange={(actor) => update("createdBy", actor ?? "")} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" type="submit"><Save />Save</Button>
        <Button size="sm" onClick={() => mutate({ ...state, editingTicketId: null })}>Cancel</Button>
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
