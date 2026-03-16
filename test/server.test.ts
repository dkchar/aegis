// test/server.test.ts
// Unit tests for src/server.ts — handleDirect() and REST API endpoints.
// Uses a real http.Server on a test-only port; no external dependencies needed.

import { describe, it, expect, vi, afterEach } from "vitest";
import * as http from "node:http";
import type { AegisConfig, SwarmState } from "../src/types.js";

// ---------------------------------------------------------------------------
// Minimal Aegis mock
// ---------------------------------------------------------------------------

function makeAegisMock(overrides: Partial<{
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  kill: (id: string) => Promise<void>;
  scale: (n: number) => void;
  focus: (f: string) => void;
  clearFocus: () => void;
  rush: (id: string) => Promise<void>;
  getState: () => SwarmState;
  onEvent: () => void;
}> = {}) {
  return {
    stop: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn().mockResolvedValue(undefined),
    scale: vi.fn(),
    focus: vi.fn(),
    clearFocus: vi.fn(),
    rush: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue({
      status: "running",
      agents: [],
      queue_depth: 0,
      total_cost_usd: 0,
      uptime_seconds: 10,
      focus_filter: null,
    } satisfies SwarmState),
    onEvent: vi.fn(),
    ...overrides,
  };
}

const BASE_CONFIG: AegisConfig = {
  version: 1,
  auth: { anthropic: "sk-ant-test", openai: null, google: null },
  models: {
    oracle: "claude-haiku-4-5",
    titan: "claude-sonnet-4-5",
    sentinel: "claude-sonnet-4-5",
    metis: "claude-haiku-4-5",
    prometheus: "claude-sonnet-4-5",
  },
  concurrency: { max_agents: 3, max_oracles: 1, max_titans: 1, max_sentinels: 1 },
  budgets: {
    oracle_turns: 5, oracle_tokens: 50000,
    titan_turns: 20, titan_tokens: 200000,
    sentinel_turns: 8, sentinel_tokens: 100000,
  },
  timing: { poll_interval_seconds: 5, stuck_warning_seconds: 90, stuck_kill_seconds: 150 },
  mnemosyne: { max_records: 500, context_budget_tokens: 1000 },
  labors: { base_path: ".aegis/labors" },
  olympus: { port: 19921, open_browser: false },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let activeServers: http.Server[] = [];

async function startServer(aegisMock: ReturnType<typeof makeAegisMock>, port: number): Promise<http.Server> {
  const { createServer } = await import("../src/server.js");
  const server = createServer(aegisMock as never, BASE_CONFIG);
  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve());
    server.on("error", reject);
  });
  activeServers.push(server);
  return server;
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function post(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = http.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
      });
    });
    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

function get(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
      });
    }).on("error", reject);
  });
}

afterEach(async () => {
  await Promise.all(activeServers.map(closeServer));
  activeServers = [];
});

// ---------------------------------------------------------------------------
// Direct mode: stop command (aegis-aap)
// ---------------------------------------------------------------------------

describe("POST /api/steer direct mode: stop (aegis-aap)", () => {
  it("calls aegis.stop() and returns ok:true", async () => {
    const aegis = makeAegisMock();
    await startServer(aegis, 19921);

    const res = await post("http://localhost:19921/api/steer", { mode: "direct", input: "stop" });

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(aegis.stop).toHaveBeenCalledOnce();
  });

  it("stop is case-insensitive", async () => {
    const aegis = makeAegisMock();
    await startServer(aegis, 19922);

    const res = await post("http://localhost:19922/api/steer", { mode: "direct", input: "STOP" });

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(aegis.stop).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Direct mode: other commands
// ---------------------------------------------------------------------------

describe("POST /api/steer direct mode: other commands", () => {
  it("pause returns ok:true and calls aegis.pause()", async () => {
    const aegis = makeAegisMock();
    await startServer(aegis, 19923);

    const res = await post("http://localhost:19923/api/steer", { mode: "direct", input: "pause" });

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(aegis.pause).toHaveBeenCalledOnce();
  });

  it("resume returns ok:true and calls aegis.resume()", async () => {
    const aegis = makeAegisMock();
    await startServer(aegis, 19924);

    const res = await post("http://localhost:19924/api/steer", { mode: "direct", input: "resume" });

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(aegis.resume).toHaveBeenCalledOnce();
  });

  it("scale <n> returns ok:true and calls aegis.scale(n)", async () => {
    const aegis = makeAegisMock();
    await startServer(aegis, 19925);

    const res = await post("http://localhost:19925/api/steer", { mode: "direct", input: "scale 5" });

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(aegis.scale).toHaveBeenCalledWith(5);
  });

  it("unknown command returns ok:false and 400", async () => {
    const aegis = makeAegisMock();
    await startServer(aegis, 19926);

    const res = await post("http://localhost:19926/api/steer", { mode: "direct", input: "frobnicate" });

    expect(res.status).toBe(400);
    expect((res.body as { ok: boolean }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /api/status
// ---------------------------------------------------------------------------

describe("GET /api/status", () => {
  it("returns 200 with SwarmState", async () => {
    const aegis = makeAegisMock();
    await startServer(aegis, 19927);

    const res = await get("http://localhost:19927/api/status");

    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------

describe("GET /api/config", () => {
  it("returns 200 with config and omits auth keys", async () => {
    const aegis = makeAegisMock();
    await startServer(aegis, 19928);

    const res = await get("http://localhost:19928/api/config");

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty("models");
    expect(body).toHaveProperty("concurrency");
    expect(body).not.toHaveProperty("auth");
  });
});
