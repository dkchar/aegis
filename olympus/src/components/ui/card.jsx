import { forwardRef } from "react";
import { cn } from "./cn.js";

export const Card = forwardRef(function Card({ className, as: Component = "section", ...props }, ref) {
  return <Component ref={ref} className={cn("min-w-0 rounded-lg border border-border bg-surface", className)} {...props} />;
});

export function CardHeader({ className, ...props }) {
  return <div className={cn("flex flex-wrap items-start justify-between gap-3 px-4 pt-4", className)} {...props} />;
}

/** Title row with an optional leading icon. */
export function CardTitle({ icon: Icon, className, children, as: Component = "h2" }) {
  return (
    <Component className={cn("flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-foreground", className)}>
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </Component>
  );
}

export function CardDescription({ className, ...props }) {
  return <p className={cn("mt-1 text-[13px] leading-snug text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return <div className={cn("flex items-center gap-2 border-t border-border px-4 py-3", className)} {...props} />;
}
