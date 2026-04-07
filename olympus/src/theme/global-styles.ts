/**
 * Olympus global styles (CSS-in-JS variant).
 *
 * Alternative to index.css stylesheet approach.
 * Kept for future theme switching or dynamic style injection.
 */

import { colors, fontSizes, spacing } from "../theme/tokens";

export const globalStyles = `
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-size: ${fontSizes.md};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: ${colors.bgPrimary};
    color: ${colors.textPrimary};
    line-height: 1.6;
  }

  ::selection {
    background-color: ${colors.primary};
    color: ${colors.bgPrimary};
  }

  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: ${colors.bgSecondary};
  }

  ::-webkit-scrollbar-thumb {
    background: ${colors.bgTertiary};
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: ${colors.bgHover};
  }

  button {
    font-family: inherit;
    cursor: pointer;
    border: none;
    background: none;
    color: inherit;
  }

  input, textarea, select {
    font-family: inherit;
    font-size: inherit;
  }

  a {
    color: ${colors.primary};
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
`;

/**
 * Inject global styles into the document head.
 * Safe to call multiple times — idempotent.
 */
let injected = false;
export function injectGlobalStyles() {
  if (injected) return;
  injected = true;

  const style = document.createElement("style");
  style.textContent = globalStyles;
  document.head.appendChild(style);
}
