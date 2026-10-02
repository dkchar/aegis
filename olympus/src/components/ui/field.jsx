import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "./cn.js";

export function Label({ className, ...props }) {
  return <LabelPrimitive.Root className={cn("text-xs font-medium text-muted-foreground", className)} {...props} />;
}

/**
 * Label, control, hint, and error stacked as one form field. Renders as a
 * <label> so clicking the caption focuses native controls; pass `as="div"`
 * for composite controls (segmented groups) that must not receive the click.
 */
export function Field({ label, hint, error, mono = false, as: Component = "label", className, children }) {
  return (
    <Component className={cn("grid min-w-0 content-start gap-1.5", className)}>
      {label && <span className={cn("text-xs font-medium text-muted-foreground", mono && "break-all font-mono")}>{label}</span>}
      {children}
      {hint && !error && <span className="text-xs leading-snug text-subtle-foreground">{hint}</span>}
      {error && <span role="alert" className="text-xs font-medium text-danger">{error}</span>}
    </Component>
  );
}
