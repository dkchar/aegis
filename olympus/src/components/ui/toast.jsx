import { CheckCircle2, OctagonAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

/** Bottom-right transient message driven by app state. */
export function Toast({ message, kind = "success", onClose }) {
  const isError = kind === "error";
  const Icon = isError ? OctagonAlert : CheckCircle2;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-[calc(100vw-2rem)] justify-end">
      <AnimatePresence>
        {message && (
          <motion.div
            key={message}
            role={isError ? "alert" : "status"}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-auto flex min-w-64 items-center gap-2.5 rounded-lg border border-border-strong bg-surface-raised px-3 py-2.5 text-[13px] shadow-elevated"
          >
            <Icon className={isError ? "size-4 shrink-0 text-danger" : "size-4 shrink-0 text-success"} aria-hidden="true" />
            <span className="min-w-0 flex-1 text-foreground">{message}</span>
            <button type="button" aria-label="Dismiss" onClick={onClose} className="grid size-6 place-items-center rounded-md text-subtle-foreground hover:bg-muted hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
