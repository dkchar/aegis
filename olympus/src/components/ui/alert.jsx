import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "./cn.js";

const tones = {
  info: { icon: Info, classes: "border-info/25 bg-info/[0.07] [&_[data-alert-icon]]:text-info" },
  success: { icon: CheckCircle2, classes: "border-success/25 bg-success/[0.07] [&_[data-alert-icon]]:text-success" },
  warning: { icon: AlertTriangle, classes: "border-warning/25 bg-warning/[0.07] [&_[data-alert-icon]]:text-warning" },
  danger: { icon: OctagonAlert, classes: "border-danger/25 bg-danger/[0.07] [&_[data-alert-icon]]:text-danger" },
  neutral: { icon: Info, classes: "border-border bg-surface [&_[data-alert-icon]]:text-muted-foreground" },
};

/** Inline callout. `role` defaults to status; use `alert` for failures. */
export function Alert({ tone = "info", title, icon, className, children, role = "status", actions = null }) {
  const Icon = icon ?? tones[tone].icon;
  return (
    <div role={role} className={cn("flex min-w-0 gap-3 rounded-lg border px-3.5 py-3 text-[13px]", tones[tone].classes, className)}>
      <Icon data-alert-icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="grid min-w-0 flex-1 gap-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children && <div className="leading-relaxed text-muted-foreground">{children}</div>}
      </div>
      {actions}
    </div>
  );
}
