import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "./cn.js";
import { controlClasses } from "./input.jsx";

/** Normalizes `["a", "b"]` or `[{ value, label }]` option lists. */
export function normalizeOptions(options = []) {
  return options.map((option) => (typeof option === "string" ? { value: option, label: option } : option));
}

const popoverClasses = "z-50 overflow-hidden rounded-lg border border-border-strong bg-surface-raised text-foreground shadow-elevated data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out";

/**
 * Single-value select. Empty string shows the placeholder.
 */
export function Select({ value, onValueChange, options, placeholder = "Select", disabled, size = "md", className, name, ...props }) {
  const items = normalizeOptions(options);
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled} name={name}>
      <SelectPrimitive.Trigger
        className={cn(
          controlClasses,
          "flex items-center justify-between gap-2 text-left data-[placeholder]:text-subtle-foreground [&>span]:truncate",
          size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-2.5",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className={cn(popoverClasses, "max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]")}>
          <SelectPrimitive.Viewport className="scroll-thin p-1">
            {items.map((item) => (
              <SelectPrimitive.Item
                key={item.value}
                value={item.value}
                className="relative flex h-7 cursor-default select-none items-center rounded-sm pl-7 pr-2 text-[13px] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{item.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { popoverClasses };
