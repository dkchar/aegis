/**
 * Olympus MVP design tokens.
 *
 * Dark-mode-first palette inspired by the Qwen CLI color scheme:
 * - Primary: teal/cyan tones (#00b4d8, #0077b6)
 * - Accent: warm amber (#f4a261) for warnings/attention
 * - Success: emerald (#2ec4b6)
 * - Danger: coral/red (#e76f51)
 * - Surface: deep navy/slate (#0d1b2a, #1b2838, #253546)
 * - Text: near-white (#e0e0e0, #b0b0b0)
 */

export const colors = {
  // Background surfaces
  bgPrimary: "#0d1b2a",
  bgSecondary: "#1b2838",
  bgTertiary: "#253546",
  bgHover: "#2d4055",

  // Primary brand
  primary: "#00b4d8",
  primaryDark: "#0077b6",
  primaryLight: "#48cae4",

  // Semantic
  success: "#2ec4b6",
  warning: "#f4a261",
  danger: "#e76f51",
  info: "#90e0ef",

  // Text
  textPrimary: "#e0e0e0",
  textSecondary: "#b0b0b0",
  textMuted: "#7a8a9e",

  // Borders
  borderDefault: "#2d4055",
  borderFocus: "#00b4d8",

  // Agent caste colors
  casteOracle: "#90e0ef",
  casteTitan: "#48cae4",
  casteSentinel: "#f4a261",
  casteJanus: "#e76f51",
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  xxl: "48px",
} as const;

export const radius = {
  sm: "4px",
  md: "8px",
  lg: "12px",
  full: "9999px",
} as const;

export const fontSizes = {
  xs: "12px",
  sm: "14px",
  md: "16px",
  lg: "20px",
  xl: "24px",
  xxl: "32px",
} as const;

export const shadows = {
  sm: "0 1px 3px rgba(0, 0, 0, 0.3)",
  md: "0 4px 6px rgba(0, 0, 0, 0.4)",
  lg: "0 10px 15px rgba(0, 0, 0, 0.5)",
} as const;

export const transitions = {
  fast: "150ms ease",
  normal: "250ms ease",
  slow: "400ms ease",
} as const;
