# Aegis — Enhancement Specification 2026

## Analysis-Driven Improvements from Industry Benchmarking

**Status:** Proposed enhancements based on 2026 industry best practices
**Created:** 2026-04-02
**Source:** Comparative analysis against AI agent frameworks, security patterns, and orchestration research
**Priority:** High-priority items should be considered for next major release

---

## Executive Summary

This document captures enhancement opportunities identified through comparative analysis of Aegis SPECv2 against current industry practices, research papers, and competing frameworks (LangGraph, CrewAI, AutoGen, Claude Code, GitHub Merge Queue, Praetorian deterministic orchestration, etc.).

**Key finding:** Aegis core architecture is validated and competitive. Eight specific enhancements are proposed to close gaps in enforcement hooks, anomaly detection, memory retrieval, and security hardening.

---

## Design Principles for Enhancements

All enhancements must preserve these SPECv2 invariants:

1. **Deterministic core** — LLM remains a nondeterministic kernel wrapped in deterministic control
2. **Thin orchestrator** — No feature bloat that absorbs runtime or tracker responsibilities
3. **Artifact-first coordination** — Structured artifacts remain authoritative over chat
4. **Windows-first portability** — All enhancements must work on Git Bash, PowerShell, and cmd
5. **Operator economics** — Lower spend, clearer pause points, visible budget gates

---

## Enhancement Catalog

### ENH-001: Deterministic Hook Injection Layer

**Priority:** HIGH  
**Effort:** Medium  
**Risk:** Low (additive, non-breaking)

#### Problem

SPECv2 enforces tool restrictions at the runtime adapter level but lacks a hook injection layer for defense-in-depth. Industry leaders (Praetorian, Microsoft ADK) use deterministic hooks that fire before/after every tool call—hooks the LLM cannot bypass through prompt manipulation.

#### Proposed Solution

Add a hook system that intercepts tool execution at the orchestration boundary:

```typescript
interface ToolHooks {
  preToolUse: (tool: string, params: any) => HookResult;
  postToolUse: (tool: string, params: any, result: any) => void;
  onStop: () => void;
}

interface HookResult {
  allow: boolean;
  reason?: string;
  transform?: any; // Optional parameter transformation
}
```

**Canonical hook types:**

| Hook | Purpose | Example Use |
|------|---------|-------------|
| `preToolUse` | Validate/transform before execution | Block writes to `**/*.env`, sanitize paths |
| `postToolUse` | Audit/observe after execution | Log file changes, update provenance tracking |
| `onStop` | Cleanup on session end | Revoke JIT credentials, close temp resources |

**Implementation rules:**
- Hooks run in the orchestration layer, not inside the runtime adapter
- Hooks cannot be disabled by agent prompts or steering
- Hook failures abort the tool call and transition session to `failed`
- Hooks must complete within 500ms to avoid blocking execution

#### Integration Points

- `monitor.ts` — Invoke hooks around tool event boundaries
- `spawner.ts` — Attach hook handlers when creating agent sessions
- `config.json` — Add optional `hooks` section for custom hook scripts

#### Example Config

```json
{
  "hooks": {
    "enabled": true,
    "scripts": [
      ".aegis/hooks/block-env-write.js",
      ".aegis/hooks/audit-file-changes.js"
    ]
  }
}
```

#### Manual Validation Gate

- Attempt to write to a blocked path and confirm hook intercepts it
- Verify hook script errors do not crash the orchestrator
- Confirm hook execution appears in Olympus event timeline

---

### ENH-002: Context Compaction Gates

**Priority:** HIGH  
**Effort:** Low  
**Risk:** Low

#### Problem

SPECv2 has token budgets but no dynamic compaction logic. Industry systems block agent spawning if context window is >85% full, preventing mid-task exhaustion.

#### Proposed Solution

Add context-aware dispatch suppression:

```typescript
interface ContextGate {
  warning_threshold_pct: number;   // Default: 85
  hard_stop_threshold_pct: number; // Default: 95
  compaction_strategy: "summarize" | "truncate" | "abort";
}
```

**Behavior:**
- Before dispatch, check `model_context_used_pct` from runtime stats
- If > `warning_threshold_pct`: emit warning, enable aggressive compaction
- If > `hard_stop_threshold_pct`: refuse dispatch, require human override
- During execution, monitor context growth rate and nudge agent to wrap up

#### Integration Points

- `triage.ts` — Check context gate before dispatch decisions
- `monitor.ts` — Track context growth during execution
- `dispatcher.ts` — Include context budget in handoff artifact

#### Manual Validation Gate

- Force a long-running session and confirm compaction nudges appear
- Verify dispatch is blocked when context exceeds hard stop
- Confirm context stats are visible in Olympus

---

### ENH-003: Mnemosyne Hybrid Retrieval Contract

**Priority:** HIGH  
**Effort:** Medium  
**Risk:** Low (additive capability)

#### Problem

SPECv2 mentions semantic retrieval as "future" but lacks a concrete design. Industry standard is hybrid search (full-text + vector similarity) with recency bias.

#### Proposed Solution

Specify the retrieval contract now to enable future embedding integration without breaking changes:

```typescript
interface MnemosyneQuery {
  text?: string;           // For FTS5 matching
  tags?: string[];         // For tag filtering (AND logic)
  embedding?: number[];    // For vector similarity (384-dim)
  limit?: number;          // Default: 10
  recency_bias?: number;   // 0.0-1.0, default: 0.3
  memory_types?: string[]; // Filter by type: note, session, learning
}

interface MnemosyneResult {
  id: string;
  content: string;
  memory_type: string;
  tags: string[];
  metadata: Record<string, any>;
  score: number;      // Combined FTS + vector score
  fts_score?: number; // Full-text component
  vector_score?: number; // Vector similarity component
}
```

**Storage schema (SQLite with sqlite-vec extension):**

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  tags JSON,
  metadata JSON,
  embedding BLOB,  -- 384-dim vector
  created_at INTEGER,
  updated_at INTEGER
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags, memory_type);

-- Triggers to keep FTS index in sync
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags, memory_type)
  VALUES (new.rowid, new.content, new.tags, new.memory_type);
END;
```

**Retrieval algorithm:**
1. If `query.embedding` provided AND sqlite-vec available: compute vector similarity
2. If `query.text` provided: compute FTS5 score
3. Combine scores: `final = (fts_score * 0.6) + (vector_score * 0.4) + (recency_bonus)`
4. Apply tag filters (AND logic)
5. Return top-K results

**Fallback behavior:**
- If sqlite-vec unavailable: degrade to FTS5-only gracefully
- If FTS5 unavailable: degrade to sequential scan with warning

#### Integration Points

- `mnemosyne.ts` — Implement hybrid query engine
- `dispatcher.ts` — Include relevant learnings in prompt construction
- `config.json` — Add `mnemosyne.embedding_model` for sidecar configuration

#### Manual Validation Gate

- Seed Mnemosyne with 50+ learnings
- Query with partial text match and confirm FTS5 retrieval
- Query with semantic similarity (different words, same meaning) and confirm vector retrieval
- Disable sqlite-vec and confirm FTS5-only fallback works

---

### ENH-004: Immutable Reasoning Traces

**Priority:** MEDIUM  
**Effort:** Medium  
**Risk:** Low

#### Problem

SPECv2 has event logs but no cryptographic integrity guarantees. Security best practice requires tamper-evident logs of agent decisions for auditability and forensics.

#### Proposed Solution

Add hash-chaining to session artifacts:

```typescript
interface ReasoningTrace {
  session_id: string;
  issue_id: string;
  caste: string;
  started_at: string;
  events: ReasoningEvent[];
  final_hash: string; // SHA-256 of all events
}

interface ReasoningEvent {
  sequence: number;
  timestamp: string;
  event_type: "tool_call" | "tool_result" | "decision" | "output";
  payload_hash: string; // SHA-256 of event payload
  previous_hash: string; // Hash of previous event (chain)
  signature?: string; // Optional: sign with orchestrator key
}
```

**Implementation rules:**
- Every significant event (tool call, decision point, output chunk) gets logged
- Each event includes hash of previous event (hash chain)
- Final session artifact includes merkle root of all events
- Tampering with any event breaks the chain

**Storage:**
- Append to `.aegis/traces/{session_id}.jsonl`
- Optionally sign with orchestrator key for non-repudiation

#### Integration Points

- `monitor.ts` — Hash and chain events as they occur
- `reaper.ts` — Compute final hash and persist trace artifact
- `olympus` — Add trace viewer for audit inspection

#### Manual Validation Gate

- Complete a session and verify trace file exists
- Modify a trace file and confirm hash verification fails
- Verify trace includes all tool calls and decisions

---

### ENH-005: Behavioral Anomaly Detection

**Priority:** MEDIUM  
**Effort:** Medium  
**Risk:** Low

#### Problem

SPECv2 has stuck detection (no tool progress for N seconds) but no behavioral anomaly detection. Industry best practice establishes baselines (tool mix, API frequency, data volume) and flags deviations.

#### Proposed Solution

Add anomaly detection to the monitor:

```typescript
interface AnomalyDetector {
  // Baselines computed from historical sessions
  baseline: {
    avg_tools_per_session: number;
    avg_file_changes_per_session: number;
    avg_session_duration_sec: number;
    common_tool_sequence: string[];
  };
  
  // Real-time detection
  detectAnomaly(session: SessionState): AnomalyAlert | null;
}

interface AnomalyAlert {
  type: "tool_spike" | "edit_loop" | "data_volume" | "unusual_sequence";
  severity: "warning" | "critical";
  description: string;
  recommended_action: "steer" | "abort" | "flag_for_review";
}
```

**Detection rules:**

| Anomaly Type | Trigger Condition | Action |
|--------------|-------------------|--------|
| `tool_spike` | >3x average tool calls in 60s | Steering nudge |
| `edit_loop` | Same file edited 5+ times in 10 min | Steering nudge, then abort |
| `data_volume` | >10MB file read in single call | Flag for review |
| `unusual_sequence` | Tool sequence differs >80% from baseline | Flag for review |

**Baseline computation:**
- Compute rolling averages from last 100 sessions per caste
- Store baselines in `.aegis/baselines.json`
- Update baselines weekly or after 100 new sessions

#### Integration Points

- `monitor.ts` — Run anomaly detection on each tool event
- `config.json` — Add `anomaly_detection.enabled` and thresholds
- `olympus` — Display anomaly alerts in event timeline

#### Manual Validation Gate

- Simulate an edit loop and confirm detection/abort
- Verify baselines are computed and persisted
- Confirm anomaly alerts appear in Olympus SSE stream

---

### ENH-006: Risk-Based Step-Up Approval Gates

**Priority:** MEDIUM  
**Effort:** Medium  
**Risk:** Low

#### Problem

SPECv2 has complex-issue pausing but no risk-based approval model. Security best practice requires step-up approval for high-risk actions (database migrations, auth changes, prod deployments).

#### Proposed Solution

Add risk scoring and approval gates:

```typescript
interface RiskGate {
  enabled: boolean;
  risk_threshold_auto: number;   // Default: 0.7 — above requires approval
  risk_threshold_block: number;  // Default: 0.9 — above requires human execution
  
  // Risk factors
  file_patterns: RiskPattern[];
  action_types: RiskPattern[];
}

interface RiskPattern {
  pattern: string;  // Glob or regex
  risk_score: number; // 0.0-1.0
  category: "data" | "auth" | "infra" | "security";
}
```

**Default risk patterns:**

```json
{
  "file_patterns": [
    { "pattern": "**/migrations/**", "risk_score": 0.8, "category": "data" },
    { "pattern": "**/*.env*", "risk_score": 0.9, "category": "security" },
    { "pattern": "**/auth/**", "risk_score": 0.85, "category": "auth" },
    { "pattern": "**/production/**", "risk_score": 0.9, "category": "infra" }
  ],
  "action_types": [
    { "pattern": "DROP TABLE", "risk_score": 0.95, "category": "data" },
    { "pattern": "chmod 777", "risk_score": 0.9, "category": "security" },
    { "pattern": "rm -rf", "risk_score": 0.95, "category": "security" }
  ]
}
```

**Behavior:**
- Oracle assessment includes risk score for proposed changes
- If `risk_score >= risk_threshold_auto`: pause for human approval before Titan dispatch
- If `risk_score >= risk_threshold_block`: refuse autonomous execution, require human to implement
- Risk score visible in Olympus before approval decision

#### Integration Points

- `triage.ts` — Compute risk score from Oracle `files_affected`
- `dispatcher.ts` — Check approval gate before Titan dispatch
- `olympus` — Add approval UI for pending high-risk issues

#### Manual Validation Gate

- Create an issue touching a migration file and confirm approval gate triggers
- Verify high-risk issues cannot be auto-dispatched without override
- Confirm risk scores are visible in Olympus

---

### ENH-007: Batch CI Optimization for Merge Queue

**Priority:** LOW  
**Effort:** Medium  
**Risk:** Medium (changes queue processing logic)

#### Problem

SPECv2 processes merge queue items one at a time. GitHub Merge Queue research shows batching compatible PRs reduces redundant CI runs by 40-60%.

#### Proposed Solution

Add optional batch processing to merge queue:

```typescript
interface BatchConfig {
  enabled: boolean;
  max_batch_size: number;      // Default: 5
  max_wait_time_sec: number;   // Default: 300 (5 min)
  compatibility_check: "strict" | "relaxed";
}
```

**Batching algorithm:**
1. Collect ready queue items up to `max_batch_size`
2. Wait up to `max_wait_time_sec` for batch to fill
3. Check compatibility:
   - **Strict:** Files touched must not overlap
   - **Relaxed:** Files can overlap if changes are additive only
4. Create combined merge group branch
5. Run CI once for entire batch
6. On success: merge all in order
7. On failure: bisect to find culprit, retry remainder

**Compatibility detection:**
```typescript
interface BatchCompatibility {
  compatible: boolean;
  reason?: string;
  overlapping_files: string[];
  conflict_risk: "low" | "medium" | "high";
}
```

#### Integration Points

- `merge-queue.ts` — Implement batch collection and compatibility checking
- `config.json` — Add `merge_queue.batch` configuration
- `olympus` — Show batch membership and CI status

#### Manual Validation Gate

- Queue 3 non-overlapping candidates and confirm they batch together
- Force CI failure on one batch member and confirm bisection works
- Verify batching reduces total CI time vs sequential processing

---

### ENH-008: Environment Awareness and Data Classification

**Priority:** LOW  
**Effort:** Medium  
**Risk:** Low

#### Problem

SPECv2 assumes single-environment operation. Enterprise best practice requires environment segmentation (dev/test/prod) and data-class restrictions (PII vs. non-PII).

#### Proposed Solution

Add environment and data-class awareness:

```typescript
interface EnvironmentConfig {
  current: "dev" | "test" | "staging" | "prod";
  allowed_environments: string[];
  data_classes: {
    pii: {
      patterns: string[];  // Files/paths containing PII
      allowed_castes: string[];  // Which castes can access
    };
    secrets: {
      patterns: string[];
      allowed_castes: string[];
    };
    public: {
      patterns: string[];
      allowed_castes: string[];
    };
  };
}
```

**Behavior:**
- Oracle cannot access PII/secrets paths unless explicitly allowed
- Titan working directory restricted to environment-appropriate paths
- Sentinel review excludes PII/secrets from model context (summarize only)
- Cross-environment operations (test→prod) require explicit approval

#### Integration Points

- `triage.ts` — Check environment compatibility before dispatch
- `dispatcher.ts` — Restrict working directory by environment
- `mnemosyne.ts` — Exclude PII/secrets from learnings store

#### Manual Validation Gate

- Configure prod environment and confirm dev-only paths are blocked
- Attempt to access PII paths and confirm access denied
- Verify environment is visible in Olympus and dispatch state

---

## Implementation Priority Matrix

| Enhancement | Priority | Effort | Dependencies | Recommended Phase |
|-------------|----------|--------|--------------|-------------------|
| ENH-001: Hook Injection | HIGH | Medium | None | Phase 1.5 |
| ENH-002: Context Gates | HIGH | Low | None | Phase 1.5 |
| ENH-003: Mnemosyne Retrieval | HIGH | Medium | None | Phase 2 |
| ENH-004: Reasoning Traces | MEDIUM | Medium | None | Phase 2 |
| ENH-005: Anomaly Detection | MEDIUM | Medium | ENH-001 | Phase 2 |
| ENH-006: Risk Gates | MEDIUM | Medium | None | Phase 2 |
| ENH-007: Batch CI | LOW | Medium | None | Phase 3 |
| ENH-008: Environment Awareness | LOW | Medium | None | Phase 3 |

---

## Backward Compatibility Rules

All enhancements must follow these compatibility rules:

1. **Opt-in by default** — Enhancements do not change default behavior unless explicitly enabled
2. **Graceful degradation** — If enhancement dependencies unavailable (e.g., sqlite-vec), system degrades gracefully
3. **Config-versioned** — Add `config_version` field; old configs remain valid with defaults
4. **No breaking changes to dispatch state** — Existing `.aegis/dispatch-state.json` remains readable

---

## Evaluation Criteria

Each enhancement must pass these evaluation gates before merging:

1. **Benchmark compliance** — Enhancement does not reduce eval harness pass rates
2. **Windows validation** — Enhancement works on Git Bash, PowerShell, and cmd
3. **Performance budget** — Enhancement adds <100ms overhead per dispatch decision
4. **Observability** — Enhancement state visible in Olympus
5. **Documentation** — Enhancement usage documented in SPECv2 or this file

---

## Research Sources

This enhancement spec is based on analysis of:

- Praetorian deterministic AI orchestration architecture (2026)
- Microsoft ADK orchestration patterns (2025)
- GitHub Merge Queue best practices (2025-2026)
- LangGraph, CrewAI, AutoGen framework comparisons
- AI agent security patterns (Hatchworks, SitePoint, 2026)
- Persistent memory architectures for coding agents (2025-2026)
- Token budgeting and cost control research (2025-2026)

---

## Next Steps

1. **Review** — Human builder reviews and prioritizes enhancements
2. **Scope** — Select 2-3 high-priority items for next sprint
3. **Implement** — Create Beads issues from this spec using Prometheus or manual decomposition
4. **Validate** — Run eval harness before and after to confirm no regression
5. **Document** — Update SPECv2 with any enhancements that become canonical

---

## Appendix A: Hook Script Example

```javascript
// .aegis/hooks/block-env-write.js
module.exports = {
  preToolUse: (tool, params) => {
    if (tool === 'write' || tool === 'edit') {
      const path = params.path || '';
      if (path.includes('.env') || path.includes('secrets/')) {
        return {
          allow: false,
          reason: 'Writes to .env and secrets/ are blocked by policy'
        };
      }
    }
    return { allow: true };
  },
  
  postToolUse: (tool, params, result) => {
    // Log all file changes for audit
    console.log(`[AUDIT] ${tool} ${params.path} at ${new Date().toISOString()}`);
  },
  
  onStop: () => {
    // Cleanup any temp resources
    console.log('[HOOK] Session stopped, cleaning up...');
  }
};
```

---

## Appendix B: Risk Gate Configuration Example

```json
{
  "risk_gate": {
    "enabled": true,
    "risk_threshold_auto": 0.7,
    "risk_threshold_block": 0.9,
    "file_patterns": [
      {
        "pattern": "**/db/migrations/**",
        "risk_score": 0.85,
        "category": "data"
      },
      {
        "pattern": "**/auth/**",
        "risk_score": 0.8,
        "category": "auth"
      },
      {
        "pattern": "**/production/**",
        "risk_score": 0.9,
        "category": "infra"
      }
    ],
    "action_patterns": [
      {
        "pattern": "DROP TABLE",
        "risk_score": 0.95,
        "category": "data"
      },
      {
        "pattern": "DELETE FROM.*WHERE",
        "risk_score": 0.8,
        "category": "data"
      }
    ]
  }
}
```

---

## Appendix C: Mnemosyne Query Example

```typescript
// Query for learnings about testing conventions
const results = await mnemosyne.query({
  text: "unit test mocking database",
  tags: ["convention", "testing"],
  memory_types: ["note", "learning"],
  limit: 5,
  recency_bias: 0.3
});

// Results include both exact text matches and semantically similar learnings
results.forEach(r => {
  console.log(`Score: ${r.score}, Content: ${r.content}`);
});
```
