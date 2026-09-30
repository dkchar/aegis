# Claude Code Instructions

@../AGENTS.md

## Working In This Repo With Claude Code

- Read `docs/AEGIS.md` before planning; it is the only source of truth.
- Check work with `node packages/agora/dist/cli.js board --json` (run `npm run build:agora` first if `dist/` is missing).
- Verify before claiming done: `npm run lint`, `npm test`, `npm run build`, and `npm run olympus:build` for UI changes.
- Tests are deterministic seam tests; never point them at a live adapter.
- Aegis can also run Claude Code as a caste runtime (`runtime: "claude"`); see `docs/runtime-adapters.md`. That adapter is product code: changes to it follow the adapter contract in `docs/AEGIS.md`.
