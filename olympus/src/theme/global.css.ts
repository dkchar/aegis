/**
 * Olympus MVP global stylesheet.
 *
 * Dark-mode-first design with smooth transitions.
 * Qwen CLI-inspired palette: teal/cyan primary, deep navy surfaces.
 */

const css = `
  /* ── Reset & base ─────────────────────────────────────── */
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :root {
    /* Background surfaces */
    --bg-primary: #0d1b2a;
    --bg-secondary: #1b2838;
    --bg-tertiary: #253546;
    --bg-hover: #2d4055;

    /* Primary brand — teal/cyan */
    --primary: #00b4d8;
    --primary-dark: #0077b6;
    --primary-light: #48cae4;

    /* Semantic */
    --success: #2ec4b6;
    --warning: #f4a261;
    --danger: #e76f51;
    --info: #90e0ef;

    /* Text */
    --text-primary: #e0e0e0;
    --text-secondary: #b0b0b0;
    --text-muted: #7a8a9e;

    /* Borders */
    --border-default: #2d4055;
    --border-focus: #00b4d8;

    /* Caste colors */
    --caste-oracle: #90e0ef;
    --caste-titan: #48cae4;
    --caste-sentinel: #f4a261;
    --caste-janus: #e76f51;

    /* Spacing */
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 16px;
    --space-lg: 24px;
    --space-xl: 32px;

    /* Radius */
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-full: 9999px;

    /* Transitions */
    --transition-fast: 150ms ease;
    --transition-normal: 250ms ease;
    --transition-slow: 400ms ease;

    /* Shadows */
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
  }

  html {
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.6;
    min-height: 100vh;
  }

  #app {
    min-height: 100vh;
  }

  ::selection {
    background-color: var(--primary);
    color: var(--bg-primary);
  }

  /* ── Scrollbar ────────────────────────────────────────── */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: var(--bg-secondary);
  }

  ::-webkit-scrollbar-thumb {
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }

  ::-webkit-scrollbar-thumb:hover {
    background: var(--bg-hover);
  }

  /* ── Focus ────────────────────────────────────────────── */
  :focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 2px;
  }

  /* ── Buttons ──────────────────────────────────────────── */
  button {
    font-family: inherit;
    cursor: pointer;
    border: none;
    background: none;
    color: inherit;
    transition: background-color var(--transition-fast),
                color var(--transition-fast),
                box-shadow var(--transition-fast);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Inputs ───────────────────────────────────────────── */
  input, textarea, select {
    font-family: inherit;
    font-size: inherit;
  }

  /* ── Links ────────────────────────────────────────────── */
  a {
    color: var(--primary);
    text-decoration: none;
    transition: color var(--transition-fast);
  }

  a:hover {
    color: var(--primary-light);
    text-decoration: underline;
  }

  /* ── Utility: fade-in animation ───────────────────────── */
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .fade-in {
    animation: fadeIn var(--transition-normal) forwards;
  }

  /* ── Utility: pulse animation for live indicators ─────── */
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .pulse {
    animation: pulse 2s ease-in-out infinite;
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
  style.textContent = css;
  document.head.appendChild(style);
}
