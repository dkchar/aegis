# Aegis Overview

`docs/AEGIS.md` is the canonical source of truth. This overview introduces the system without replacing that spec.

## Product Shape

Aegis is a deterministic swarm orchestrator for software work. It coordinates multiple live agent sessions, but the model sessions do not own orchestration truth.

Aegis owns:

- task intake from Agora
- runnable work selection
- session dispatch and monitoring
- graph mutation policy
- candidate merge routing
- durable logs and artifacts
- final proof checks

Agent sessions own scoped execution. They can inspect files, implement, test, and produce artifacts inside their assigned work area.

## Why Deterministic Control

Software swarms fail when a prompt becomes the control plane. Aegis separates reasoning from authority:

- agents produce typed artifacts
- Aegis validates those artifacts
- Aegis mutates state mechanically
- operators inspect truth through terminal files and Olympus

This makes retries, blockers, merge failures, and operational exhaustion visible instead of hidden in session prose.

## Current Proof Goal

The key product proof is a real adapter draining the seeded animated React todo graph into a working app. Scripted tests prove seams, but they are not the live MVP proof.

The seeded proof must show:

- Agora executable tickets drained to `done`
- no ticket left halted or runnable
- a generated React todo app installs, builds, and runs
- Oracle, Titan, Sentinel, Janus, merge, logs, and transcripts explain the path
- all root and labor mutations are validated

## Olympus

Olympus is the local operator console. It provides supervision, observability, and deterministic controls over existing Aegis truth planes.

Olympus does not seed the mock graph. Seeding remains a terminal command so proof setup is scriptable and auditable.
