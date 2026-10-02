import { Bell, Boxes, CheckCircle2, GitMerge, ListChecks, OctagonAlert, Play, Plus, RefreshCw, Save, Search, Square, TerminalSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  CasteIcon,
  EmptyState,
  FactList,
  LiveDot,
  SectionCard,
  Stat,
  StatBar,
  StatusBadge,
  casteMeta,
} from "../components/aegis.jsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Code,
  CodeBlock,
  CollapsibleSection,
  Combobox,
  CountBadge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Kbd,
  NumberInput,
  Progress,
  Segmented,
  Select,
  Separator,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toast,
  Tooltip,
} from "../components/ui/index.js";
import { TicketPreview } from "../liveOps/TicketCard.jsx";
import TerminalPane from "../TerminalPane.jsx";
import { themePreferences, useTheme } from "../theme.js";

/**
 * Living reference for the Olympus design system: tokens, primitives, and
 * the Aegis compositions built on them. Served at /design.html.
 */

const sections = [
  ["tokens", "Tokens"],
  ["type", "Typography"],
  ["buttons", "Buttons"],
  ["badges", "Badges & status"],
  ["castes", "Castes & liveness"],
  ["forms", "Form controls"],
  ["overlays", "Overlays"],
  ["navigation", "Navigation"],
  ["feedback", "Feedback"],
  ["data", "Data display"],
  ["aegis", "Aegis surfaces"],
];

const colorTokens = [
  ["background", "bg-background"],
  ["surface", "bg-surface"],
  ["surface-raised", "bg-surface-raised"],
  ["surface-sunken", "bg-surface-sunken"],
  ["muted", "bg-muted"],
  ["border-strong", "bg-border-strong"],
  ["primary", "bg-primary"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
  ["info", "bg-info"],
  ["violet", "bg-violet"],
  ["terminal", "bg-terminal"],
];

const tones = ["neutral", "accent", "success", "warning", "danger", "info", "violet"];
const statuses = ["running", "queued", "succeeded", "merged", "pending", "reworking", "cooldown", "blocked", "failed", "idle"];
const models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-haiku-4-5-20251001"];

const sampleTicket = {
  id: "AG-0007",
  kind: "feature",
  title: "Animate todo list transitions with motion presets",
  body: "Add enter/exit animations to todo items and respect prefers-reduced-motion.",
  column: "in_progress",
  trackerColumn: "ready",
  runtimeStage: "implementing",
  runtimeAgent: { caste: "titan", sessionId: "titan-AG-0007-1" },
  blockedBy: [],
  scope: ["src/TodoList.tsx", "src/motion.ts"],
  labels: ["ui", "motion"],
  lease: { sessionId: "titan-AG-0007-1" },
};

const terminalSession = {
  id: "titan-AG-0007-1",
  lines: [
    "$ claude -p --model claude-opus-5-5 --output-format stream-json",
    "2026-10-02T14:02:11.204Z [session] started titan for AG-0007 in .aegis/labors/AG-0007",
    "2026-10-02T14:02:13.880Z [assistant] Reading the todo list component and motion helpers.",
    "2026-10-02T14:02:14.019Z [tool] Read src/TodoList.tsx",
    "2026-10-02T14:02:19.442Z [tool] Edit src/TodoList.tsx (+24 -6)",
    "2026-10-02T14:02:25.117Z [tool] Bash npm test -- TodoList",
    "2026-10-02T14:02:31.903Z [tool_error] 1 failing: exit animation not awaited",
    "2026-10-02T14:02:40.551Z [tool] Edit src/motion.ts (+9 -2)",
    "2026-10-02T14:02:47.006Z [result] tests pass; writing titan handoff",
  ],
};

export default function DesignSystem() {
  const theme = useTheme();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="grid leading-tight">
            <h1 className="text-[15px] font-semibold tracking-tight">Design system</h1>
            <span className="font-mono text-[11px] text-muted-foreground">Olympus · tokens, primitives, Aegis surfaces</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><a href="/">Open Olympus</a></Button>
            <Segmented size="sm" aria-label="Theme" options={themePreferences} value={theme.preference} onValueChange={theme.setPreference} />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="sticky top-20 grid gap-0.5">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-surface-raised hover:text-foreground">{label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="grid min-w-0 gap-6">
          <Tokens />
          <Typography />
          <Buttons />
          <Badges />
          <Castes />
          <Forms />
          <Overlays />
          <Navigation />
          <Feedback />
          <DataDisplay />
          <AegisSurfaces />
        </main>
      </div>
    </div>
  );
}

function Section({ id, title, description, children }) {
  return (
    <section id={id} className="grid scroll-mt-20 gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, className, children }) {
  return (
    <Card className="grid gap-3 p-4">
      {label && <span className="font-mono text-[11px] uppercase tracking-wide text-subtle-foreground">{label}</span>}
      <div className={className ?? "flex flex-wrap items-center gap-2"}>{children}</div>
    </Card>
  );
}

function Tokens() {
  return (
    <Section id="tokens" title="Tokens" description="Semantic OKLCH tokens in styles.css. Components never use raw colors, so the light theme is one override block.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {colorTokens.map(([name, className]) => (
          <div key={name} className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className={`h-12 border-b border-border ${className}`} />
            <div className="px-2.5 py-2 font-mono text-[11px] text-muted-foreground">--{name}</div>
          </div>
        ))}
      </div>
      <Specimen label="Radius · elevation">
        {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map((radius) => (
          <div key={radius} className={`grid size-20 place-items-center border border-border-strong bg-surface-raised font-mono text-[10px] text-muted-foreground ${radius}`}>{radius.replace("rounded-", "")}</div>
        ))}
        <div className="grid h-20 w-36 place-items-center rounded-lg border border-border-strong bg-surface-raised font-mono text-[10px] text-muted-foreground shadow-elevated">shadow-elevated</div>
      </Specimen>
    </Section>
  );
}

function Typography() {
  return (
    <Section id="type" title="Typography" description="Geist for interface text, Geist Mono for ids, paths, numbers, and terminals.">
      <Specimen className="grid gap-2">
        <p className="text-2xl font-semibold tracking-tight">Drain the seeded todo graph</p>
        <p className="text-base font-semibold tracking-tight">Section title · 16 / semibold</p>
        <p className="text-sm font-semibold tracking-tight">Card title · 14 / semibold</p>
        <p className="text-[13px] text-foreground">Body · 13 / regular. Olympus favors dense, quiet text with clear hierarchy.</p>
        <p className="text-[13px] text-muted-foreground">Muted · supporting descriptions and hints.</p>
        <p className="text-xs text-subtle-foreground">Subtle · metadata, timestamps, and captions.</p>
        <p className="font-mono text-xs">Mono · AG-0007 · .aegis/dispatch-state.json · 2026-10-02T14:02:11Z</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">12/18</p>
      </Specimen>
    </Section>
  );
}

function Buttons() {
  const [loading, setLoading] = useState(false);
  return (
    <Section id="buttons" title="Buttons" description="Variants by intent, sizes by density. Icon-only buttons always carry an aria-label and a tooltip.">
      <Specimen label="Variants">
        <Button variant="primary"><Play />Start</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger"><Trash2 />Delete</Button>
        <Button variant="danger-soft"><Square />Stop</Button>
        <Button variant="link">Link</Button>
      </Specimen>
      <Specimen label="Sizes · states">
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
        <Tooltip content="Refresh state"><Button variant="ghost" size="icon" aria-label="Refresh state"><RefreshCw /></Button></Tooltip>
        <Tooltip content="Add ticket"><Button variant="secondary" size="icon-sm" aria-label="Add ticket"><Plus /></Button></Tooltip>
        <Button disabled>Disabled</Button>
        <Button variant="primary" loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1500); }}>
          {!loading && <Save />}Save config
        </Button>
      </Specimen>
    </Section>
  );
}

function Badges() {
  return (
    <Section id="badges" title="Badges & status" description="Tone carries meaning; StatusBadge maps any Aegis status string onto a tone.">
      {["soft", "outline", "dot"].map((variant) => (
        <Specimen key={variant} label={`Badge · ${variant}`}>
          {tones.map((tone) => <Badge key={tone} tone={tone} variant={variant}>{tone}</Badge>)}
        </Specimen>
      ))}
      <Specimen label="StatusBadge">
        {statuses.map((status) => <StatusBadge key={status} status={status} />)}
      </Specimen>
      <Specimen label="CountBadge · Kbd">
        <span className="inline-flex items-center gap-1.5 text-[13px]">Sessions <CountBadge value={3} tone="success" /></span>
        <span className="inline-flex items-center gap-1.5 text-[13px]">Records <CountBadge value={2} tone="danger" /></span>
        <span className="inline-flex items-center gap-1.5 text-[13px]">Queue <CountBadge value={5} /></span>
        <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">Jump to view <Kbd>1</Kbd>–<Kbd>5</Kbd></span>
      </Specimen>
    </Section>
  );
}

function Castes() {
  return (
    <Section id="castes" title="Castes & liveness" description="Each caste has a fixed icon and hue across the board, sessions, records, and config.">
      <Specimen>
        {Object.entries(casteMeta).map(([caste, meta]) => (
          <Badge key={caste} tone={meta.tone} size="md"><CasteIcon caste={caste} className="text-current" />{meta.label}</Badge>
        ))}
        <Separator orientation="vertical" className="h-5" />
        <span className="inline-flex items-center gap-2 text-[13px]"><LiveDot tone="success" live />running</span>
        <span className="inline-flex items-center gap-2 text-[13px]"><LiveDot tone="warning" />paused</span>
        <span className="inline-flex items-center gap-2 text-[13px]"><LiveDot tone="danger" />stopped</span>
        <span className="inline-flex items-center gap-2 text-[13px]"><LiveDot tone="neutral" />idle</span>
      </Specimen>
    </Section>
  );
}

function Forms() {
  const [model, setModel] = useState("claude-opus-5-5");
  const [thinking, setThinking] = useState("high");
  const [runtime, setRuntime] = useState("claude");
  const [count, setCount] = useState("4");
  return (
    <Section id="forms" title="Form controls" description="Radix Select, cmdk Combobox for long model lists, steppers for numbers, and Field for label/hint/error.">
      <Card className="grid gap-5 p-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Title" hint="Short, imperative summary.">
          <Input placeholder="Add todo filters" />
        </Field>
        <Field label="Search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
            <Input className="pl-8" placeholder="Filter tickets" />
          </div>
        </Field>
        <Field label="labor.base_path" mono error="labor.base_path is required.">
          <Input aria-invalid placeholder=".aegis/labors" />
        </Field>
        <Field label="runtime" mono>
          <Select value={runtime} onValueChange={setRuntime} options={["claude", "codex", "pi"]} aria-label="runtime" />
        </Field>
        <Field label="models.titan" mono hint="Searchable; typing filters.">
          <Combobox value={model} onValueChange={setModel} options={models} placeholder="Select authenticated model" clearable aria-label="models.titan" />
        </Field>
        <Field label="concurrency.max_agents" mono>
          <NumberInput value={count} onChange={setCount} min={1} max={64} aria-label="concurrency.max_agents" />
        </Field>
        <Field as="div" label="thinking.titan" mono>
          <Segmented size="sm" options={["off", "low", "medium", "high"]} value={thinking} onValueChange={setThinking} aria-label="thinking.titan" />
        </Field>
        <Field label="Body" className="md:col-span-2">
          <Textarea placeholder="Acceptance criteria, scope notes…" minRows={2} />
        </Field>
      </Card>
    </Section>
  );
}

function Overlays() {
  return (
    <Section id="overlays" title="Overlays" description="Dialogs trap focus and close on Escape; tooltips open on hover and keyboard focus.">
      <Specimen>
        <Dialog>
          <DialogTrigger asChild><Button variant="primary"><Plus />Open dialog</Button></DialogTrigger>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Add ticket</DialogTitle>
              <DialogDescription>Creates an Agora issue; Aegis triages it on the next poll.</DialogDescription>
            </DialogHeader>
            <Field label="Title"><Input autoFocus placeholder="Persist todos to localStorage" /></Field>
            <DialogFooter>
              <Button variant="ghost">Cancel</Button>
              <Button variant="primary">Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Tooltip content="Latest loop event: dispatch AG-0007 → titan"><Button variant="outline">Hover for tooltip</Button></Tooltip>
      </Specimen>
    </Section>
  );
}

function Navigation() {
  const [filter, setFilter] = useState("All");
  return (
    <Section id="navigation" title="Navigation" description="Tabs for peer views, Segmented for filters, Collapsible for secondary detail.">
      <Card className="grid gap-4 p-4">
        <Tabs defaultValue="ops">
          <TabsList aria-label="Example views">
            <TabsTrigger value="ops"><Boxes />Ops</TabsTrigger>
            <TabsTrigger value="sessions"><TerminalSquare />Sessions <CountBadge value={2} tone="success" /></TabsTrigger>
            <TabsTrigger value="records"><ListChecks />Records</TabsTrigger>
          </TabsList>
          <TabsContent value="ops" className="pt-3 text-[13px] text-muted-foreground">Board, workspace, and loop health.</TabsContent>
          <TabsContent value="sessions" className="pt-3 text-[13px] text-muted-foreground">Live adapter terminals.</TabsContent>
          <TabsContent value="records" className="pt-3 text-[13px] text-muted-foreground">Dispatch, merge, and artifact records.</TabsContent>
        </Tabs>
        <Segmented options={["All", "Oracle", "Titan", "Sentinel", "Janus"]} value={filter} onValueChange={setFilter} aria-label="Caste filter" />
        <CollapsibleSection title="Daemon events, run health, and logs" icon={Bell} meta="3 sections">
          <p className="text-[13px] text-muted-foreground">Secondary detail stays one click away instead of crowding the board.</p>
        </CollapsibleSection>
      </Card>
    </Section>
  );
}

function Feedback() {
  const [toast, setToast] = useState("");
  const [kind, setKind] = useState("success");
  const show = (nextKind, message) => {
    setKind(nextKind);
    setToast(message);
  };
  return (
    <Section id="feedback" title="Feedback" description="Alerts for persistent state, toasts for transient results, skeletons while views load.">
      <div className="grid gap-2 md:grid-cols-2">
        <Alert tone="info" title="claude adapter">Claude Code runs each caste as a headless session. Sign in with <Code>claude</Code> once before starting.</Alert>
        <Alert tone="success" title="Run complete">All 18 tracker records reached Done.</Alert>
        <Alert tone="warning" title="Sentinel requested rework">AG-0009 verdict: fail · 2 findings.</Alert>
        <Alert tone="danger" role="alert" title="Provider usage limit reached">AG-0011 halted after 3 failures.</Alert>
      </div>
      <Specimen label="Progress · Toast · Skeleton" className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <Progress value={64} label="accent" />
          <Progress value={100} tone="success" label="success" />
          <Progress value={40} tone="warning" label="warning" />
          <Progress value={20} tone="danger" label="danger" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => show("success", "Config saved")}><CheckCircle2 />Success toast</Button>
          <Button onClick={() => show("error", "Daemon failed to start: config gaps")}><OctagonAlert />Error toast</Button>
        </div>
        <div className="grid gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-16" />
        </div>
      </Specimen>
      <Toast message={toast} kind={kind} onClose={() => setToast("")} />
    </Section>
  );
}

function DataDisplay() {
  return (
    <Section id="data" title="Data display" description="Cards, stats, facts, empty states, and code.">
      <StatBar>
        <Stat label="Progress" value="12/18" hint="67% of executable tickets done" progress={67} icon={CheckCircle2} />
        <Stat label="Sessions" value={3} hint="9 recorded" icon={TerminalSquare} tone="success" />
        <Stat label="Merge queue" value={1} hint="11 merged" icon={GitMerge} tone="accent" />
        <Stat label="Failures" value={1} hint="halted or exhausted" icon={OctagonAlert} tone="danger" />
      </StatBar>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle icon={Boxes}>Card</CardTitle>
              <CardDescription>Header, content, and footer slots.</CardDescription>
            </div>
            <Badge tone="accent">badge</Badge>
          </CardHeader>
          <CardContent>
            <FactList items={[["Issue", "AG-0007"], ["Caste", "titan"], ["Session", "titan-AG-0007-1"], ["Labor", ".aegis/labors/AG-0007"]]} />
          </CardContent>
          <CardFooter><Button size="sm" variant="ghost">Secondary</Button><Button size="sm" variant="primary" className="ml-auto">Action</Button></CardFooter>
        </Card>
        <SectionCard icon={ListChecks} title="SectionCard" description="Titled card used by every Olympus panel." actions={<Badge>3</Badge>}>
          <EmptyState icon={GitMerge} title="Merge queue empty" detail="Completed implementation work appears here when it is ready for integration." />
        </SectionCard>
      </div>
      <CodeBlock className="max-h-48">{JSON.stringify({ issueId: "AG-0009", verdict: "fail", findings: [{ severity: "major", summary: "Exit animation blocks list removal" }] }, null, 2)}</CodeBlock>
    </Section>
  );
}

function AegisSurfaces() {
  return (
    <Section id="aegis" title="Aegis surfaces" description="Compositions from the live views: a board ticket and a session terminal.">
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="self-start p-2.5">
          <TicketPreview ticket={sampleTicket} />
        </Card>
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <CasteIcon caste="titan" />
            <span className="font-mono text-xs">{terminalSession.id}</span>
            <StatusBadge status="running" className="ml-auto" />
          </div>
          <TerminalPane session={terminalSession} />
        </Card>
      </div>
    </Section>
  );
}
