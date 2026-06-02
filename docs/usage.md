# Usage Guide

This guide gives operator commands. `docs/AEGIS.md` remains the canonical source of truth.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Initialize A Project

```bash
node dist/index.js init
```

This creates Aegis project state paths and updates ignore rules as needed.

## Start And Stop

```bash
node dist/index.js start
node dist/index.js stop
```

## Status And Logs

```bash
node dist/index.js status
node dist/index.js stream daemon
```

Use these before trusting UI state. Terminal and `.aegis` files are the authority.

## Direct Phase Commands

```bash
node dist/index.js poll
node dist/index.js dispatch
node dist/index.js monitor
node dist/index.js reap
```

## Direct Caste Commands

```bash
node dist/index.js scout AG-0001
node dist/index.js implement AG-0001
node dist/index.js review AG-0001
node dist/index.js process AG-0001
```

## Merge

```bash
node dist/index.js merge next
```

## Olympus

Start the operator console:

```bash
npm run olympus:dev
```

Open:

```text
http://127.0.0.1:4173/
```

Build or check Olympus:

```bash
npm run olympus:build
npm run olympus:check
```

## Seeded Mock Proof Commands

Seeding remains command-only.

```bash
npm run mock:seed
npm run mock:run
npm run mock:acceptance
```

The seeded mock path is a proof fixture. Olympus can observe the resulting truth planes, but it should not hide setup behind a seed button.

## Verification

Typical local gates:

```bash
npm run olympus:check
npm test
npm run lint
npm run build
```

Do not claim proof completion without checking command output, dispatch state, merge state, artifacts, and generated app behavior.
