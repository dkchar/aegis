# Phase G Proof Reset Handoff Note

Use this note for follow-up work after the emergency MVP rewrite.

Emergency rewrite phases are complete.

Read first:
- `docs/superpowers/specs/2026-04-13-aegis-emergency-mvp-triage-design.md`
- `docs/superpowers/specs/2026-04-13-aegis-emergency-triage-discovery.md`
- `docs/superpowers/specs/2026-04-13-aegis-emergency-deferred-items.md`

Current state:
- Phase A complete.
- Phase B complete.
- Phase C complete.
- Phase D complete.
- Phase E complete.
- Phase F complete.
- Phase G complete on 2026-04-16.
- CI is seam-only.
- Seeded mock-run acceptance is the end-to-end proof surface.

Fresh follow-up work belongs in new addenda and Beads issues, not by reopening Phase G.

Use this rule for post-triage work:
- file a new addendum when the next recovery slice needs policy or scope clarification
- file a new Beads issue when implementation work is needed
- keep Phase G closed unless the source-of-truth spec is explicitly reopened

Rules:
- do not reintroduce deferred systems
- do not drift back into UI, SSE, economics, Mnemosyne, or eval harness work
- keep CI on deterministic seam tests
- keep end-to-end proof in seeded mock-run acceptance

If a later task needs a new operator surface or recovery phase, start from a fresh addendum and issue chain instead of rewriting this handoff note.
