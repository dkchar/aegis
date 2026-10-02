import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "olympus.theme";
export const themePreferences = ["system", "light", "dark"];

function readPreference() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return themePreferences.includes(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function resolveTheme(preference) {
  if (preference !== "system") return preference;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

/** System/light/dark preference persisted per browser; applied to <html data-theme>. */
export function useTheme() {
  const [preference, setPreferenceState] = useState(readPreference);
  const [theme, setTheme] = useState(() => resolveTheme(readPreference()));

  useEffect(() => {
    const update = () => {
      const next = resolveTheme(preference);
      setTheme(next);
      applyTheme(next);
    };
    update();
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    media?.addEventListener("change", update);
    return () => media?.removeEventListener("change", update);
  }, [preference]);

  const setPreference = useCallback((next) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable; the choice still applies for this page.
    }
    setPreferenceState(next);
  }, []);

  return { preference, setPreference, theme };
}
