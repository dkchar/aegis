// src/server.ts
// HTTP server for Aegis — SSE event stream, REST API, and static Olympus files.
// This is the ONLY module that handles HTTP/SSE. No other module creates HTTP endpoints.

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

import type { Aegis } from "./aegis.js";
import type { AegisConfig, SSEEvent } from "./types.js";

// ---------------------------------------------------------------------------
// MIME type table for static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function getMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Safe config (strips API keys before sending to clients)
// ---------------------------------------------------------------------------

function safeConfig(config: AegisConfig): unknown {
  return {
    version: config.version,
    models: config.models,
    concurrency: config.concurrency,
    budgets: config.budgets,
    timing: config.timing,
    mnemosyne: config.mnemosyne,
    labors: config.labors,
    olympus: config.olympus,
    // auth is intentionally omitted
  };
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sseWrite(res: http.ServerResponse, event: SSEEvent): void {
  const data = JSON.stringify(event.data);
  res.write(`event: ${event.type}\ndata: ${data}\n\n`);
}

// ---------------------------------------------------------------------------
// Direct-mode command parser
// ---------------------------------------------------------------------------

interface DirectResult {
  ok: boolean;
  message: string;
}

async function handleDirect(input: string, aegis: Aegis): Promise<DirectResult> {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === "pause") {
    aegis.pause();
    return { ok: true, message: "Orchestrator paused." };
  }

  if (trimmed === "resume") {
    aegis.resume();
    return { ok: true, message: "Orchestrator resumed." };
  }

  const killMatch = /^kill\s+(\S+)$/.exec(trimmed);
  if (killMatch) {
    const agentId = killMatch[1] ?? "";
    await aegis.kill(agentId);
    return { ok: true, message: `Kill signal sent to agent ${agentId}.` };
  }

  const scaleMatch = /^scale\s+(\d+)$/.exec(trimmed);
  if (scaleMatch) {
    const n = parseInt(scaleMatch[1] ?? "0", 10);
    aegis.scale(n);
    return { ok: true, message: `Concurrency scaled to ${n}.` };
  }

  const focusMatch = /^focus\s+(.+)$/.exec(input.trim()); // preserve case
  if (focusMatch) {
    const filter = focusMatch[1] ?? "";
    aegis.focus(filter);
    return { ok: true, message: `Focus filter set to "${filter}".` };
  }

  if (trimmed === "clear focus" || trimmed === "clearfocus") {
    aegis.clearFocus();
    return { ok: true, message: "Focus filter cleared." };
  }

  const rushMatch = /^rush\s+(\S+)$/.exec(trimmed);
  if (rushMatch) {
    const issueId = rushMatch[1] ?? "";
    await aegis.rush(issueId);
    return { ok: true, message: `Rushing ${issueId} — Titan dispatched.` };
  }

  const statusCmds = new Set(["status", "state", "info"]);
  if (statusCmds.has(trimmed)) {
    const state = aegis.getState();
    return { ok: true, message: JSON.stringify(state, null, 2) };
  }

  return { ok: false, message: `Unknown direct command: "${input}". Try: pause, resume, kill <id>, scale <n>, focus <text>, rush <issue-id>` };
}

// ---------------------------------------------------------------------------
// Request body helper
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

export function createServer(aegisInstance: Aegis, config: AegisConfig): http.Server {
  const olympusDistDir = path.resolve("olympus", "dist");

  /** Set of active SSE response objects */
  const sseClients = new Set<http.ServerResponse>();

  // Subscribe to orchestrator events and fan out to all SSE connections
  aegisInstance.onEvent((event: SSEEvent) => {
    for (const res of sseClients) {
      try {
        sseWrite(res, event);
      } catch {
        sseClients.delete(res);
      }
    }
  });

  const server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      void handleRequest(req, res);
    }
  );

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const parsed = url.parse(req.url ?? "/");
    const pathname = parsed.pathname ?? "/";

    // ------------------------------------------------------------------
    // GET /api/events  — SSE endpoint
    // ------------------------------------------------------------------
    if (req.method === "GET" && pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Send initial state snapshot
      const snapshot: SSEEvent = {
        type: "orchestrator.snapshot",
        data: aegisInstance.getState(),
        timestamp: Date.now(),
      };
      sseWrite(res, snapshot);

      // Register for ongoing events
      sseClients.add(res);

      // Heartbeat every 15 s to keep the connection alive
      const heartbeatTimer = setInterval(() => {
        try {
          res.write(`: heartbeat\n\n`);
        } catch {
          clearInterval(heartbeatTimer);
          sseClients.delete(res);
        }
      }, 15_000);

      req.on("close", () => {
        clearInterval(heartbeatTimer);
        sseClients.delete(res);
      });

      return;
    }

    // ------------------------------------------------------------------
    // GET /api/status  — current SwarmState as JSON
    // ------------------------------------------------------------------
    if (req.method === "GET" && pathname === "/api/status") {
      const state = aegisInstance.getState();
      sendJson(res, 200, state);
      return;
    }

    // ------------------------------------------------------------------
    // GET /api/config  — non-sensitive config
    // ------------------------------------------------------------------
    if (req.method === "GET" && pathname === "/api/config") {
      sendJson(res, 200, safeConfig(config));
      return;
    }

    // ------------------------------------------------------------------
    // POST /api/steer  — steering commands
    // ------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/steer") {
      let body: string;
      try {
        body = await readBody(req);
      } catch {
        sendJson(res, 400, { error: "Failed to read request body" });
        return;
      }

      let parsed_body: unknown;
      try {
        parsed_body = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      if (
        typeof parsed_body !== "object" ||
        parsed_body === null ||
        !("mode" in parsed_body) ||
        !("input" in parsed_body)
      ) {
        sendJson(res, 400, { error: 'Body must be { mode: string, input: string }' });
        return;
      }

      const steerBody = parsed_body as { mode: string; input: string };

      if (steerBody.mode === "direct") {
        try {
          const result = await handleDirect(steerBody.input, aegisInstance);
          sendJson(res, result.ok ? 200 : 400, result);
        } catch (err) {
          sendJson(res, 500, { ok: false, message: String(err) });
        }
        return;
      }

      // Metis (steer/ask) and Prometheus (plan) are Stage 3 — not yet implemented
      sendJson(res, 501, {
        ok: false,
        message: `Mode "${steerBody.mode}" is not implemented in Stage 2. Use "direct" mode.`,
      });
      return;
    }

    // ------------------------------------------------------------------
    // CORS pre-flight for /api/*
    // ------------------------------------------------------------------
    if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    // ------------------------------------------------------------------
    // GET /*  — static files from olympus/dist/
    // ------------------------------------------------------------------
    if (req.method === "GET") {
      await serveStatic(pathname, res, olympusDistDir);
      return;
    }

    // Fallthrough
    sendJson(res, 405, { error: "Method not allowed" });
  }

  return server;
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

async function serveStatic(
  pathname: string,
  res: http.ServerResponse,
  distDir: string
): Promise<void> {
  // Sanitize path to prevent directory traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(distDir, safePath);

  // Prefer index.html for directory requests or missing files (SPA routing)
  if (!fs.existsSync(distDir)) {
    // Olympus hasn't been built yet
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Aegis — Olympus not built</title></head>
<body>
<h1>Olympus dashboard not built</h1>
<p>Run <code>npm run build:olympus</code> to build the dashboard, then restart Aegis.</p>
<p>The orchestrator is running. API endpoints are available at <code>/api/status</code>, <code>/api/events</code>, and <code>/api/config</code>.</p>
</body>
</html>`);
    return;
  }

  // Check if exact path is a file
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // Fall back to index.html for SPA client-side routing
    filePath = path.join(distDir, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": getMime(filePath),
      "Cache-Control": filePath.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=86400",
    });
    res.end(content);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal server error");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
