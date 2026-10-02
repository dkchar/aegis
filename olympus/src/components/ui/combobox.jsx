import { Command } from "cmdk";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { cn } from "./cn.js";
import { controlClasses } from "./input.jsx";
import { normalizeOptions, popoverClasses } from "./select.jsx";

/**
 * Searchable select for long option lists (adapter models). Typing filters;
 * `clearable` adds a reset control.
 */
export function Combobox({ value, onValueChange, options, placeholder = "Select", searchPlaceholder = "Search…", emptyText = "No matches", clearable = false, disabled, className, ...props }) {
  const [open, setOpen] = useState(false);
  const items = normalizeOptions(options);
  const selected = items.find((item) => item.value === value);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={cn("relative min-w-0", className)}>
        <Popover.Trigger
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          className={cn(controlClasses, "flex h-8 items-center justify-between gap-2 px-2.5 text-left", clearable && value && "pr-14")}
          {...props}
        >
          <span className={cn("truncate", !selected && !value && "text-subtle-foreground")}>{selected?.label ?? (value || placeholder)}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
        </Popover.Trigger>
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => onValueChange("")}
            className="absolute right-7 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-subtle-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className={cn(popoverClasses, "w-[var(--radix-popover-trigger-width)] min-w-64 p-0")}>
          <Command loop className="flex max-h-80 flex-col">
            <Command.Input
              placeholder={searchPlaceholder}
              className="h-9 w-full border-b border-border bg-transparent px-3 text-[13px] text-foreground outline-none placeholder:text-subtle-foreground"
            />
            <Command.List className="scroll-thin overflow-y-auto p-1">
              <Command.Empty className="px-2 py-6 text-center text-xs text-muted-foreground">{emptyText}</Command.Empty>
              {items.map((item) => (
                <Command.Item
                  key={item.value}
                  value={`${item.label} ${item.value}`}
                  onSelect={() => {
                    onValueChange(item.value);
                    setOpen(false);
                  }}
                  className="relative flex h-7 cursor-default select-none items-center rounded-sm pl-7 pr-2 text-[13px] outline-none data-[selected=true]:bg-muted"
                >
                  {item.value === value && <Check className="absolute left-2 size-3.5 text-primary" aria-hidden="true" />}
                  <span className="truncate">{item.label}</span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
