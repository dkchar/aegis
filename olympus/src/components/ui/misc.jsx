import { forwardRef } from "react";
import { cn } from "./cn.js";

export function Kbd({ className, ...props }) {
  return (
    <kbd
      className={cn("inline-grid h-4 min-w-4 place-items-center rounded border border-border-strong bg-surface-sunken px-1 font-mono text-[10px] font-medium text-subtle-foreground", className)}
      {...props}
    />
  );
}

/** Scrollable monospace block for logs, JSON, and paths. */
export const CodeBlock = forwardRef(function CodeBlock({ className, ...props }, ref) {
  return (
    <pre
      ref={ref}
      className={cn("scroll-thin overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-sunken p-3 font-mono text-xs leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
});

export function Code({ className, ...props }) {
  return <code className={cn("rounded border border-border bg-surface-sunken px-1 py-0.5 font-mono text-[0.85em]", className)} {...props} />;
}

export function Skeleton({ className, ...props }) {
  return <div className={cn("animate-pulse rounded-md bg-muted/70", className)} {...props} />;
}

export function Separator({ orientation = "horizontal", className }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn("shrink-0 bg-border", orientation === "vertical" ? "h-full w-px" : "h-px w-full", className)}
    />
  );
}
