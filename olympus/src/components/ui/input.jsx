import { Minus, Plus } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "./cn.js";

export const controlClasses = "w-full min-w-0 rounded-md border border-input bg-surface-sunken text-sm text-foreground shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger/60 aria-invalid:ring-danger/20";

export const Input = forwardRef(function Input({ className, type = "text", ...props }, ref) {
  return <input ref={ref} type={type} className={cn(controlClasses, "h-8 px-2.5", className)} {...props} />;
});

/** Grows with its content (CSS field-sizing) from `minRows`. */
export const Textarea = forwardRef(function Textarea({ className, minRows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={minRows}
      className={cn(controlClasses, "field-sizing-content min-h-16 resize-y px-2.5 py-1.5 leading-relaxed", className)}
      {...props}
    />
  );
});

/**
 * Numeric input with steppers. Reports values as strings so callers keep
 * their own validation (config values are validated as text).
 */
export function NumberInput({ value, onChange, min, max, step = 1, className, ...props }) {
  const current = Number(value);
  const clamp = (next) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next));
  const nudge = (delta) => onChange(String(clamp((Number.isFinite(current) ? current : (min ?? 0)) + delta)));

  return (
    <div className={cn("flex min-w-0", className)}>
      <input
        type="number"
        inputMode="numeric"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className={cn(controlClasses, "h-8 rounded-r-none px-2.5 font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none")}
        {...props}
      />
      <div className="flex">
        <StepButton label="Decrease" onClick={() => nudge(-step)} disabled={min !== undefined && current <= min}><Minus /></StepButton>
        <StepButton label="Increase" onClick={() => nudge(step)} disabled={max !== undefined && current >= max} last><Plus /></StepButton>
      </div>
    </div>
  );
}

function StepButton({ label, last = false, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "grid w-8 place-items-center border border-l-0 border-input bg-surface-sunken text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5",
        last && "rounded-r-md",
      )}
      {...props}
    >
      {children}
    </button>
  );
}
