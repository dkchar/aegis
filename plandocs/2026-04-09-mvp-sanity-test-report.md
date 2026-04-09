# MVP Sanity Test Report — 2026-04-09

## Context

After delivering PR #57 (aegis-smk: align Olympus API/SSE contract with client DashboardState), ran end-to-end sanity testing against the built CLI in a seeded mock repo to verify all SPECv2 contracts hold.

## Commands Run

```bash
# 1. Build and test the full suite
npm run build
npm run lint
npm run test                    # 1321 tests, 0 failures

# 2. Seed the mock repo
npm run mock:seed

# 3. Verify initial ready queue (mock repo)
cd aegis-mock-run && bd ready --json
# → Only "foundation.contract" is ready

# 4. Run mock-run integration tests
npm run test -- tests/integration/mock-run/seed-mock-run.test.ts
# → 4/4 pass (repo creation, ready queue, config validation, lane parallelism)

# 5. CLI lifecycle in mock repo
node dist/index.js init          # idempotent, "0 paths created"
node dist/index.js status        # → server_state: stopped
node dist/index.js start --port 43210 --no-browser
```

## SPECv2 Endpoint Verification

| # | Endpoint | Expected | Result |
|---|----------|----------|--------|
| 1 | `GET /` | Olympus HTML shell | **PASS** — `<!doctype html>` returned |
| 2 | `GET /api/state` | `{ status, spend, agents }` DashboardState shape | **PASS** |
| 3 | `GET /api/events` | SSE stream with `text/event-stream` | **PASS** — proper SSE frames |
| 4 | `POST /api/steer` | Control-plane actions accepted | **PASS** — command, auto_on, pause all work |
| 5 | `POST /api/learning` | Mnemosyne append with validation | **PASS** — rejects invalid sources correctly |
| 6 | SSE `orchestrator.state` payload | `{ status, spend, agents }` in envelope | **PASS** — payload matches DashboardState |

### Verified API Response Shape

```json
{
  "status": {
    "mode": "conversational",
    "isRunning": true,
    "uptimeSeconds": 20,
    "activeAgents": 0,
    "queueDepth": 0,
    "paused": false
  },
  "spend": {
    "metering": "unknown",
    "totalInputTokens": 0,
    "totalOutputTokens": 0
  },
  "agents": [],
  "server_token": "<uuid>"
}
```

### Verified SSE Event Frame

```
id: evt-1
event: orchestrator.state
retry: 1500
data: {"id":"evt-1","type":"orchestrator.state","timestamp":"...","sequence":1,"payload":{"status":{"mode":"conversational","isRunning":true,"uptimeSeconds":0,"activeAgents":0,"queueDepth":0,"paused":false},"spend":{"metering":"unknown","totalInputTokens":0,"totalOutputTokens":0},"agents":[]}}
```

## Steering Actions Verified

| Action | Request | Response | State Change |
|--------|---------|----------|--------------|
| `command: status` | `POST /api/steer` with `args.command` | `ok: true, status: "handled"` | N/A |
| `auto_on` | `POST /api/steer` with `action: "auto_on"` | `ok: true, mode: "auto"` | `status.mode` → `"auto"` |
| `auto_off` | `POST /api/steer` with `action: "auto_off"` | `ok: true, mode: "conversational"` | `status.mode` → `"conversational"` |
| `pause` | `POST /api/steer` with `action: "pause"` | `ok: true` | `status.paused` → `true` |

## Lifecycle Verification

| Phase | Command | Expected | Result |
|-------|---------|----------|--------|
| Init | `aegis init` | Creates/validates `.aegis/`, idempotent | **PASS** |
| Status (stopped) | `aegis status` | `server_state: "stopped"` | **PASS** |
| Start | `aegis start --port 43210 --no-browser` | Server listens, prints URL | **PASS** |
| Status (running) | `aegis status` | `server_state: "running"`, `uptime_ms > 0` | **PASS** |
| Stop | `aegis stop` | Graceful shutdown, persists state | **PASS** |
| Status (after stop) | `aegis status` | `server_state: "stopped"`, `uptime_ms: 0` | **PASS** |

## Gate Results

| Gate | Result | Notes |
|------|--------|-------|
| `npm run build` | **PASS** | Node + Olympus build clean |
| `npm run lint` | **PASS** | TypeScript type-check clean (both workspaces) |
| `npm run test` | **PASS** | 1321 tests, 0 failures |
| Mock-run seeder tests | **PASS** | 4/4 integration tests |
| Launch lifecycle tests | **PASS** | 9/9 start-stop tests |
| SPECv2 manual gates | **PASS** | All 16 contracts verified |

## Issues Discovered

**None.** All SPECv2 MVP contracts hold after the API/SSE fix.

---

## How to Test the Browser Dashboard Yourself

### Prerequisites

- Node.js 18+ installed
- `bd` CLI installed and on PATH
- This repo cloned and dependencies installed (`npm install`)
- The project built (`npm run build`)

### Step-by-Step

#### 1. Build the project

```bash
npm run build
```

This compiles both the Node backend and the Olympus frontend bundle.

#### 2. Seed the mock repo (optional but recommended)

```bash
npm run mock:seed
```

This creates `aegis-mock-run/` with a pre-configured Beads issue graph and Aegis config.

#### 3. Start Aegis

From the **mock repo** (or any Aegis-initialized repo):

```bash
cd aegis-mock-run
node ../dist/index.js start
```

By default this:
- Starts on port **3847** (configurable with `--port 12345`)
- Opens your browser automatically
- Starts in **conversational mode** (idle, no auto-processing)

To skip the browser:

```bash
node ../dist/index.js start --no-browser
```

#### 4. Open the dashboard

If you used `--no-browser`, navigate to:

```
http://127.0.0.1:3847
```

Or whatever port you specified.

#### 5. What you should see

The Olympus dashboard should load with:

- **Top bar**: Shows "Running" status, "Conversational" mode, active agent count (0), spend, uptime, queue depth
- **Auto toggle**: A switch to enable/disable auto mode
- **Settings gear icon**: Opens the settings panel
- **Agent cards area**: Empty (no agents running yet)
- **Command bar**: Text input at the bottom for sending commands

#### 6. Try steering commands

In the command bar at the bottom of the dashboard, type:

```
status
```

You should see a response confirming the orchestrator status.

Try:

```
auto on
```

The top bar should update to show "Auto" mode. Then:

```
auto off
```

Should return to "Conversational" mode.

#### 7. Verify real-time updates

The dashboard connects via Server-Sent Events (SSE). You should see:
- Status updates reflected immediately when you toggle auto mode
- Uptime counter incrementing
- If you had agents running, agent cards would appear and update live

#### 8. Stop the server

In your terminal, press **Ctrl+C** or run:

```bash
node ../dist/index.js stop
```

The dashboard will lose its SSE connection (expected). The server shuts down gracefully and persists state.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module` | Not built | Run `npm run build` |
| `bd init failed` | bd CLI not compatible | Ensure `bd` supports `--shared-server` flag |
| Dashboard shows empty/blank | API contract mismatch | You may be on an old commit; pull latest and rebuild |
| Port already in use | Previous server still running | `node dist/index.js stop` or kill the process |
| SSE not connecting | Server not running | Confirm `aegis start` succeeded and check the port |

### Verifying the API directly

You can curl the endpoints independently:

```bash
# Full dashboard state
curl http://127.0.0.1:3847/api/state

# SSE event stream (will hang open — Ctrl+C to stop)
curl http://127.0.0.1:3847/api/events

# Send a command
curl -X POST http://127.0.0.1:3847/api/steer \
  -H "Content-Type: application/json" \
  -d '{"action":"command","request_id":"test-1","issued_at":"2026-04-09T00:00:00Z","source":"olympus","args":{"command":"status"}}'
```
