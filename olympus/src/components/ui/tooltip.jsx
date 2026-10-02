import { Tooltip as TooltipPrimitive } from "radix-ui";

export const TooltipProvider = TooltipPrimitive.Provider;

/** Wraps a single focusable child with a hover/focus hint. */
export function Tooltip({ content, side = "bottom", children }) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-border-strong bg-surface-raised px-2 py-1 text-xs text-foreground shadow-elevated data-[state=delayed-open]:animate-pop-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
