import { useCallback, useEffect, useRef } from "react";

const TOAST_MS = 2_400;

/**
 * Wraps a state setter so any state carrying a toast clears it after a delay.
 * One timer per app instead of a global on `window`.
 */
export function useToastingSetter(setState) {
  const timerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return useCallback((nextState) => {
    setState(nextState);
    if (!nextState?.toast) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setState((current) => ({ ...current, toast: "" }));
    }, TOAST_MS);
  }, [setState]);
}

function isTypingTarget(target) {
  const tag = target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
}

/** Number keys 1..N select views; ignored while typing or with modifiers held. */
export function useNumberKeyNavigation(ids, onSelect) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < ids.length) {
        onSelect(ids[index]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ids, onSelect]);
}
