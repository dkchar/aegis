# Agora Upstream

Embedded copy of standalone Agora package.

- Upstream repo: https://github.com/dkchar/agora
- Current upstream commit: `11af720`
- Current package version: `0.3.0`

Rule:

- Changes made under `packages/agora/` must be ported to `C:\dev\agora` and pushed to `dkchar/agora`.
- Changes made in `C:\dev\agora` must be copied back here before Aegis uses them.
- Until npm publishing is stable, this embedded copy is the Aegis runtime source for Agora.

## Pending Upstream Port

Local changes not yet ported to `dkchar/agora`:

- `store.ts`: next event id reads only the tail of `events.jsonl` instead of the whole file, and snapshot temp files use unique names.
