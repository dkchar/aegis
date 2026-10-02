import { ChevronRight } from "lucide-react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { cn } from "./cn.js";

/** Card-styled disclosure for secondary detail. */
export function CollapsibleSection({ title, icon: Icon, meta, defaultOpen = false, className, children }) {
  return (
    <CollapsiblePrimitive.Root defaultOpen={defaultOpen} className={cn("group/collapsible min-w-0 rounded-lg border border-border bg-surface", className)}>
      <CollapsiblePrimitive.Trigger className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-semibold tracking-tight transition-colors hover:bg-surface-raised/60">
        <ChevronRight className="size-4 shrink-0 text-subtle-foreground transition-transform duration-150 group-data-[state=open]/collapsible:rotate-90" aria-hidden="true" />
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="truncate">{title}</span>
        {meta && <span className="ml-auto text-xs font-normal text-muted-foreground">{meta}</span>}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="border-t border-border p-4">{children}</CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
