import { GitMerge, Hammer, ShieldCheck, Telescope } from "lucide-react";
import { Badge, Card, CardDescription, CardHeader, CardTitle, Progress, Tooltip, cn } from "./ui/index.js";

/**
 * Aegis-specific building blocks composed from the ui primitives: status
 * semantics, caste identity, stats, and empty states.
 */

const SUCCESS = ["pass", "done", "accepted", "succeeded", "merged", "complete", "connected"];
const ACTIVE = ["running", "streaming", "ready", "queued", "merging", "active", "verdict ready"];
const WARNING = ["watch", "pending", "idle", "in_progress", "in_review", "ready_to_merge", "cooldown", "reworking", "paused", "connecting"];
const DANGER = ["blocked", "blocked_on_child", "failed", "halted", "error", "failed_operational", "failure", "offline"];

/** Maps any Aegis status string onto a semantic tone. */
export function statusTone(status) {
  const value = String(status ?? "").toLowerCase();
  if (SUCCESS.includes(value)) return "success";
  if (ACTIVE.includes(value)) return "accent";
  if (WARNING.includes(value)) return "warning";
  if (DANGER.includes(value)) return "danger";
  return "neutral";
}

export function StatusBadge({ status, children = status, variant = "soft", size, className }) {
  return <Badge tone={statusTone(status)} variant={variant} size={size} className={className}>{children}</Badge>;
}

export const casteMeta = {
  oracle: { label: "Oracle", icon: Telescope, tone: "info", text: "text-info" },
  titan: { label: "Titan", icon: Hammer, tone: "accent", text: "text-primary" },
  sentinel: { label: "Sentinel", icon: ShieldCheck, tone: "violet", text: "text-violet" },
  janus: { label: "Janus", icon: GitMerge, tone: "warning", text: "text-warning" },
};

export function resolveCaste(caste) {
  return casteMeta[String(caste ?? "").toLowerCase()] ?? null;
}

export function CasteIcon({ caste, className }) {
  const meta = resolveCaste(caste);
  if (!meta) return null;
  const Icon = meta.icon;
  return <Icon className={cn("size-3.5 shrink-0", meta.text, className)} aria-label={meta.label} />;
}

/** Pulsing dot for live state; static when idle. */
export function LiveDot({ tone = "success", live = false, label, className }) {
  const color = { success: "text-success bg-success", warning: "text-warning bg-warning", danger: "text-danger bg-danger", neutral: "text-subtle-foreground bg-subtle-foreground", accent: "text-primary bg-primary" }[tone];
  const dot = <span className={cn("inline-block size-2 shrink-0 rounded-full", color, live && "animate-pulse-ring", className)} aria-hidden={label ? undefined : "true"} aria-label={label} role={label ? "img" : undefined} />;
  return label ? <Tooltip content={label}>{dot}</Tooltip> : dot;
}

/** Card with a titled header (icon, title, description, actions) and a body. */
export function SectionCard({ icon, title, description, actions = null, className, bodyClassName, children }) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle icon={icon}>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </CardHeader>
      <div className={cn("min-w-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </Card>
  );
}

/** One row of run KPIs; a 1px grid gap over a border-colored backdrop draws the hairlines. */
export function StatBar({ children, className }) {
  return (
    <section
      aria-label="Run summary"
      className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none", className)}
    >
      {children}
    </section>
  );
}

const statText = { neutral: "text-foreground", accent: "text-primary", success: "text-success", warning: "text-warning", danger: "text-danger" };

export function Stat({ label, value, hint, tone = "neutral", icon: Icon, progress = null }) {
  return (
    <div className="grid min-w-0 content-start gap-1 bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums", statText[tone])}>{value}</div>
      {hint && <div className="truncate text-xs text-subtle-foreground">{hint}</div>}
      {progress !== null && <Progress value={progress} tone={tone === "neutral" ? "accent" : tone} className="mt-1" label={label} />}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, detail, className, children = null }) {
  return (
    <div className={cn("grid min-h-32 place-items-center rounded-lg border border-dashed border-border-strong px-6 py-8 text-center", className)}>
      <div className="grid max-w-sm justify-items-center gap-1.5">
        {Icon && <Icon className="mb-1 size-5 text-subtle-foreground" aria-hidden="true" />}
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail && <p className="text-[13px] leading-snug text-muted-foreground">{detail}</p>}
        {children}
      </div>
    </div>
  );
}

/** Label/value pairs; values wrap anywhere so ids and paths never overflow. */
export function FactList({ items, columns = 2, className }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-3", columns === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : columns === 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2", className)}>
      {items.map(([label, value]) => (
        <div key={label} className="grid min-w-0 gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="m-0 break-all font-mono text-xs text-foreground">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amount < 0.01 ? "<$0.01" : `$${amount.toFixed(2)}`;
}

export function formatTokens(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amount >= 1_000_000 ? `${(amount / 1_000_000).toFixed(1)}M` : amount >= 1_000 ? `${(amount / 1_000).toFixed(1)}k` : String(amount);
}

/** `2026-10-02T22:16:07.372Z` -> local `22:16:07`; other text is returned unchanged. */
export function formatClock(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleTimeString([], { hour12: false }) : value;
}
