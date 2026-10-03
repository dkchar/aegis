# Screenshots

1600x900 captures of Olympus at `http://127.0.0.1:4173/`, supervising the seeded animated React todo graph mid-run with the Claude Code adapter: foundation and core merged, a Titan implementing the UI lane, and a Sentinel re-reviewing the motion lane after a failed verdict. Dark is the default theme; every view also has a light capture.

## Ops

![Olympus Ops](screenshots/olympus-ops.png)

![Olympus Ops, light theme](screenshots/olympus-ops-light.png)

## Sessions

![Olympus Sessions](screenshots/olympus-sessions.png)

![Olympus Sessions, light theme](screenshots/olympus-sessions-light.png)

## Aether

![Olympus Aether](screenshots/olympus-aether.png)

![Olympus Aether, light theme](screenshots/olympus-aether-light.png)

## Records

![Olympus Records](screenshots/olympus-records.png)

![Olympus Records, light theme](screenshots/olympus-records-light.png)

## Config

![Olympus Config](screenshots/olympus-config.png)

![Olympus Config, light theme](screenshots/olympus-config-light.png)

## Design System Gallery

Served at `/design.html`; see [Olympus design system](olympus.md#design-system).

![Design system: tokens and type](screenshots/olympus-design-system.png)

![Design system: badges, status, castes, and controls](screenshots/olympus-design-components.png)

![Design system: data display and Aegis surfaces, light theme](screenshots/olympus-design-surfaces-light.png)

## Regenerating

```bash
npm run build
OLYMPUS_SCREENSHOT_THEMES=dark,light npm run olympus:screenshots
```

The script (`olympus/scripts/screenshots.mjs`) builds a sample workspace in a temporary directory with the real `mock:seed` graph and the Aegis state writers, starts Olympus against it on port 4183, and drives headless Chromium through `playwright-core`. No live adapter runs; the sample state is deterministic apart from timestamps.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OLYMPUS_SCREENSHOT_THEMES` | `dark` | Comma-separated themes; non-dark themes get a `-<theme>` suffix. |
| `OLYMPUS_SCREENSHOT_DIR` | `docs/screenshots` | Output directory. |
| `OLYMPUS_SCREENSHOT_CHROMIUM` | Playwright's browser | Chromium executable to use instead of a Playwright-managed download. |
| `OLYMPUS_SCREENSHOT_PORT` | `4183` | Port for the temporary Olympus server. |
| `OLYMPUS_SCREENSHOT_KEEP` | unset | Keep the sample workspace and print its path. |
