import { ToggleGroup } from "radix-ui";
import { cn } from "./cn.js";
import { normalizeOptions } from "./select.jsx";

/** Single-choice segmented control (filters, small mode switches). */
export function Segmented({ value, onValueChange, options, className, size = "md", ...props }) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange(next)}
      className={cn("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface-sunken p-0.5", className)}
      {...props}
    >
      {normalizeOptions(options).map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-surface-raised data-[state=on]:text-foreground data-[state=on]:shadow-sm [&_svg]:size-3.5",
            size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]",
          )}
        >
          {option.icon}
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
