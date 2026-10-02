import { cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import { forwardRef } from "react";
import { cn } from "./cn.js";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        secondary: "border border-border bg-surface-raised text-foreground hover:border-border-strong hover:bg-muted",
        outline: "border border-border-strong bg-transparent text-foreground hover:bg-surface-raised",
        ghost: "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
        danger: "bg-danger text-background shadow-sm hover:bg-danger/90",
        "danger-soft": "border border-danger/25 bg-danger/10 text-danger hover:bg-danger/15",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 rounded-sm px-2 text-xs [&_svg]:size-3.5",
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3",
        lg: "h-10 px-4",
        icon: "size-8",
        "icon-sm": "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

/**
 * Button with variants, sizes, and a loading state. `asChild` renders the
 * styling onto its child (for links).
 */
export const Button = forwardRef(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, type = "button", ...props },
  ref,
) {
  if (asChild) {
    return <Slot.Root ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>{children}</Slot.Root>;
  }
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});
