import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "./cn.js";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }) {
  return <TabsPrimitive.List className={cn("flex min-w-0 items-center gap-0.5 overflow-x-auto", className)} {...props} />;
}

/** Quiet nav tab: muted until hovered, raised surface when active. */
export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-surface-raised data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_0_0_1px_var(--border)] [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}
