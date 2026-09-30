import { createTheme } from "@mantine/core";

const sans = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const mono = '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace';

// Olympus brand accent: a cool aegis teal that reads well on dark surfaces.
const aegis = [
  "#e3fbf8",
  "#c9f2ec",
  "#96e4da",
  "#5fd5c6",
  "#35c9b6",
  "#1bc1ab",
  "#00bda7",
  "#00a592",
  "#009381",
  "#007f6e",
];

// Slightly blue-shifted neutrals for depth without pure black.
const dark = [
  "#d5dbe5",
  "#b3bccb",
  "#8c97aa",
  "#667286",
  "#3c4658",
  "#2a3242",
  "#1d2432",
  "#151b26",
  "#0f141d",
  "#0a0e15",
];

export const olympusTheme = createTheme({
  primaryColor: "aegis",
  primaryShade: { dark: 5 },
  colors: { aegis, dark },
  defaultRadius: "md",
  fontFamily: sans,
  fontFamilyMonospace: mono,
  headings: {
    fontFamily: sans,
    fontWeight: "750",
  },
  cursorType: "pointer",
  focusRing: "auto",
  components: {
    Paper: {
      defaultProps: { radius: "md" },
    },
    Badge: {
      defaultProps: { radius: "sm" },
      styles: { root: { textTransform: "none", fontWeight: 650, letterSpacing: 0 } },
    },
    Button: {
      defaultProps: { radius: "md" },
    },
    Tabs: {
      styles: { tab: { fontWeight: 600 } },
    },
    Tooltip: {
      defaultProps: { withArrow: true, openDelay: 250 },
    },
  },
});
