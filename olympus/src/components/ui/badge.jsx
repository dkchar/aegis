import { cva } from "class-variance-authority";
import { cn } from "./cn.js";

const toneText = {
  neutral: "text-muted-foreground",
  accent: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  violet: "text-violet",
};

export const badgeVariants = cva(
  "inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted/60",
        accent: "border-primary/25 bg-primary/10",
        success: "border-success/25 bg-success/10",
        warning: "border-warning/25 bg-warning/10",
        danger: "border-danger/25 bg-danger/10",
        info: "border-info/25 bg-info/10",
        violet: "border-violet/25 bg-violet/10",
      },
      variant: {
        soft: "",
        outline: "bg-transparent",
        dot: "border-border bg-transparent text-muted-foreground",
      },
      size: {
        sm: "h-5 px-2 text-[11px]",
        md: "h-6 px-2.5 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", variant: "soft", size: "sm" },
  },
);

const dotColor = {
  neutral: "bg-subtle-foreground",
  accent: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  violet: "bg-violet",
};

/**
 * Small status or metadata label. `dot` shows a colored dot with neutral text.
 * Plain text truncates; mixed content (an icon plus text) lays out inline.
 */
export function Badge({ className, tone = "neutral", variant = "soft", size, children, ...props }) {
  const plainText = typeof children === "string" || typeof children === "number";
  return (
    <span
      className={cn(badgeVariants({ tone, variant, size }), variant === "dot" ? "" : toneText[tone], className)}
      {...props}
    >
      {variant === "dot" && <span className={cn("size-1.5 rounded-full", dotColor[tone])} aria-hidden="true" />}
      {plainText ? <span className="truncate">{children}</span> : children}
    </span>
  );
}

/** Numeric count bubble for tabs and nav items. */
export function CountBadge({ value, tone = "neutral", className }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold tabular-nums",
        tone === "danger" ? "bg-danger text-background" : tone === "success" ? "bg-success text-background" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {value}
    </span>
  );
}
