#!/usr/bin/env node
// src/index.ts
// Aegis CLI entry point.
// Commands: init, start, status, stop

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as http from "node:http";
import { execFile } from "node:child_process";

import { loadConfig, getDefaultConfig } from "./config.js";
import { Aegis } from "./aegis.js";
import { createServer } from "./server.js";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface StartOptions {
  port?: number;
  concurrency?: number;
  model?: string;
  noBrowser: boolean;
  verbose: boolean;
}

function parseArgs(): { command: string; args: string[] } {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "";
  return { command, args: argv.slice(1) };
}

function parseStartOptions(args: string[]): StartOptions {
  const opts: StartOptions = { noBrowser: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--no-browser") {
      opts.noBrowser = true;
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else if (arg === "--port" && args[i + 1]) {
      opts.port = parseInt(args[++i] ?? "3847", 10);
    } else if (arg === "--concurrency" && args[i + 1]) {
      opts.concurrency = parseInt(args[++i] ?? "3", 10);
    } else if (arg === "--model" && args[i + 1]) {
      opts.model = args[++i];
    } else if (arg.startsWith("--port=")) {
      opts.port = parseInt(arg.slice("--port=".length), 10);
    } else if (arg.startsWith("--concurrency=")) {
      opts.concurrency = parseInt(arg.slice("--concurrency=".length), 10);
    } else if (arg.startsWith("--model=")) {
      opts.model = arg.slice("--model=".length);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

function checkBd(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("bd", ["--version"], (err) => {
      resolve(!err);
    });
  });
}

function isGitRepo(): boolean {
  return fs.existsSync(path.join(process.cwd(), ".git"));
}

function beadsExists(): boolean {
  return fs.existsSync(path.join(process.cwd(), ".beads"));
}

// ---------------------------------------------------------------------------
// Browser opener
// ---------------------------------------------------------------------------

function openBrowser(urlToOpen: string): void {
  // Best-effort: ignore all errors — UI convenience only
  if (process.platform === "win32") {
    // cmd /c start "" <url>  (empty string is the required window title)
    execFile("cmd", ["/c", "start", "", urlToOpen], () => {});
  } else if (process.platform === "darwin") {
    execFile("open", [urlToOpen], () => {});
  } else {
    execFile("xdg-open", [urlToOpen], () => {});
  }
}

// ---------------------------------------------------------------------------
// init command
// ---------------------------------------------------------------------------

async function runInit(): Promise<void> {
  const projectRoot = process.cwd();
  const aegisDir = path.join(projectRoot, ".aegis");
  const configPath = path.join(aegisDir, "config.json");
  const mnemoPath = path.join(aegisDir, "mnemosyne.jsonl");
  const gitignorePath = path.join(projectRoot, ".gitignore");

  console.log("Initializing Aegis...\n");

  // 1. Create .aegis/ directory
  if (!fs.existsSync(aegisDir)) {
    fs.mkdirSync(aegisDir, { recursive: true });
    console.log("✓ Created .aegis/");
  } else {
    console.log("  .aegis/ already exists");
  }

  // 2. Create config.json
  if (!fs.existsSync(configPath)) {
    const isTTY = process.stdin.isTTY && process.stdout.isTTY;

    if (isTTY) {
      // Interactive setup
      const config = await interactiveSetup();
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    } else {
      // Non-interactive: write template config
      const defaultCfg = getDefaultConfig();
      // Replace placeholder in default config
      (defaultCfg.auth as Record<string, unknown>).anthropic = "YOUR_ANTHROPIC_API_KEY_HERE";
      fs.writeFileSync(configPath, JSON.stringify(defaultCfg, null, 2), { mode: 0o600 });
      console.log("✓ Created .aegis/config.json (template — edit to add your API key)");
      console.log("\n  Next: edit .aegis/config.json and set your Anthropic API key.");
    }
  } else {
    console.log("  .aegis/config.json already exists — skipping");
  }

  // 3. Create empty mnemosyne.jsonl
  if (!fs.existsSync(mnemoPath)) {
    fs.writeFileSync(mnemoPath, "", "utf8");
    console.log("✓ Created .aegis/mnemosyne.jsonl");
  }

  // 4. Append to .gitignore
  const gitignoreEntries = [
    ".aegis/config.json",
    ".aegis/labors/",
    ".aegis/dispatch-state.json",
  ];

  let gitignoreContent = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf8")
    : "";

  let added = false;
  for (const entry of gitignoreEntries) {
    if (!gitignoreContent.includes(entry)) {
      gitignoreContent += (gitignoreContent.endsWith("\n") ? "" : "\n") + entry + "\n";
      added = true;
    }
  }
  if (added) {
    fs.writeFileSync(gitignorePath, gitignoreContent, "utf8");
    console.log("✓ Updated .gitignore");
  }

  console.log("\nAegis initialized! Next steps:");
  console.log("  1. Make sure bd (beads) is installed: https://github.com/steveyegge/beads");
  console.log("  2. Run 'bd init' if you haven't already");
  console.log("  3. Run 'aegis start' to begin orchestrating");
}

async function interactiveSetup(): Promise<ReturnType<typeof getDefaultConfig>> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  console.log("Aegis Interactive Setup\n");

  const apiKey = await ask("Anthropic API key (sk-ant-...): ");
  const portStr = await ask("Olympus port [3847]: ");
  const concurrencyStr = await ask("Max simultaneous agents [3]: ");

  rl.close();

  const config = getDefaultConfig();
  if (apiKey.trim()) config.auth.anthropic = apiKey.trim();
  const port = parseInt(portStr.trim() || "3847", 10);
  const concurrency = parseInt(concurrencyStr.trim() || "3", 10);
  if (!isNaN(port)) config.olympus.port = port;
  if (!isNaN(concurrency)) config.concurrency.max_agents = concurrency;

  console.log("\n✓ Configuration saved to .aegis/config.json");
  return config;
}

// ---------------------------------------------------------------------------
// start command
// ---------------------------------------------------------------------------

async function runStart(opts: StartOptions): Promise<void> {
  const projectRoot = process.cwd();

  // 1. Load config
  let config;
  try {
    config = loadConfig(projectRoot);
  } catch (err) {
    console.error(`Error: ${String(err)}`);
    console.error("Run 'aegis init' to create the configuration file.");
    process.exit(1);
  }

  // Apply CLI overrides
  if (opts.port !== undefined) config.olympus.port = opts.port;
  if (opts.concurrency !== undefined) config.concurrency.max_agents = opts.concurrency;
  if (opts.model !== undefined) {
    config.models.oracle = opts.model;
    config.models.titan = opts.model;
    config.models.sentinel = opts.model;
    config.models.metis = opts.model;
    config.models.prometheus = opts.model;
  }

  // 2. Verify bd is in PATH
  const bdAvailable = await checkBd();
  if (!bdAvailable) {
    console.error("Error: bd (beads) CLI not found in PATH.");
    console.error("Install it: https://github.com/steveyegge/beads");
    console.error("  Windows: irm https://raw.githubusercontent.com/steveyegge/beads/main/install.ps1 | iex");
    console.error("  macOS/Linux: curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash");
    process.exit(1);
  }

  // 3. Verify .beads/ exists
  if (!beadsExists()) {
    console.error("Error: .beads/ directory not found. Run 'bd init' first.");
    process.exit(1);
  }

  // 4. Verify git repo
  if (!isGitRepo()) {
    console.error("Error: Not a git repository. Aegis requires git for Labor isolation (git worktrees).");
    process.exit(1);
  }

  // 5. Create Aegis instance
  const aegisInstance = new Aegis(config, projectRoot);

  // 6. Start HTTP server
  const server = createServer(aegisInstance, config);

  await new Promise<void>((resolve, reject) => {
    server.listen(config.olympus.port, () => resolve());
    server.on("error", reject);
  });

  // 7. Open browser (unless --no-browser)
  const dashboardUrl = `http://localhost:${config.olympus.port}`;
  if (!opts.noBrowser && config.olympus.open_browser) {
    openBrowser(dashboardUrl);
  }

  // 8. Set up SIGINT/SIGTERM for graceful shutdown
  let shuttingDown = false;

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);

    try {
      await aegisInstance.stop();
    } catch (err) {
      console.error("Error during shutdown:", err);
    }

    server.close(() => {
      process.exit(0);
    });

    // Force exit after 70 s (beyond the 60 s agent wait)
    setTimeout(() => {
      console.error("Forced exit after timeout.");
      process.exit(1);
    }, 70_000).unref();
  };

  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));

  // 9. Print status line
  console.log(`Aegis running at ${dashboardUrl} — Ctrl+C to stop`);

  if (opts.verbose) {
    // Forward all SSE events to stderr
    aegisInstance.onEvent((event) => {
      process.stderr.write(`[aegis] ${JSON.stringify(event)}\n`);
    });
  }

  // 10. Begin the Layer 1 loop (start() returns after kicking off the timer)
  try {
    await aegisInstance.start();
  } catch (err) {
    console.error("Failed to start orchestrator:", err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// status command
// ---------------------------------------------------------------------------

async function runStatus(): Promise<void> {
  // Determine port from config if available, else use default
  let port = 3847;
  try {
    const config = loadConfig(process.cwd());
    port = config.olympus.port;
  } catch {
    // Use default
  }

  const statusUrl = `http://localhost:${port}/api/status`;

  await new Promise<void>((resolve) => {
    http
      .get(statusUrl, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            const state = JSON.parse(body) as unknown;
            console.log(JSON.stringify(state, null, 2));
          } catch {
            console.error("Failed to parse status response.");
          }
          resolve();
        });
      })
      .on("error", () => {
        console.error(`Aegis does not appear to be running on port ${port}.`);
        console.error(`Start it with: aegis start`);
        resolve();
      });
  });
}

// ---------------------------------------------------------------------------
// stop command
// ---------------------------------------------------------------------------

async function runStop(): Promise<void> {
  let port = 3847;
  try {
    const config = loadConfig(process.cwd());
    port = config.olympus.port;
  } catch {
    // Use default
  }

  const stopUrl = `http://localhost:${port}/api/steer`;
  const body = JSON.stringify({ mode: "direct", input: "stop" });

  console.log("Sending stop signal to running Aegis instance...");
  console.log("(Alternatively, use Ctrl+C in the terminal where aegis is running.)");

  await new Promise<void>((resolve) => {
    const req = http.request(
      stopUrl,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body_text = Buffer.concat(chunks).toString("utf8");
          console.log("Response:", body_text);
          resolve();
        });
      }
    );
    req.on("error", () => {
      console.error(`Aegis does not appear to be running on port ${port}.`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
Usage: aegis <command> [options]

Commands:
  init          Initialize .aegis/ directory and run first-time setup
  start         Start the orchestrator and open Olympus
  status        Print current swarm state to terminal (for scripting)
  stop          Gracefully stop the running orchestrator

Options for 'start':
  --port <N>            Olympus port (default: 3847)
  --concurrency <N>     Max simultaneous agents (overrides config)
  --model <model>       Default model for all castes (overrides config)
  --no-browser          Don't auto-open Olympus
  --verbose             Print full agent event stream to stderr
  `.trim());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { command, args } = parseArgs();

switch (command) {
  case "init":
    void runInit().catch((err) => {
      console.error("init failed:", err);
      process.exit(1);
    });
    break;

  case "start":
    void runStart(parseStartOptions(args)).catch((err) => {
      console.error("start failed:", err);
      process.exit(1);
    });
    break;

  case "status":
    void runStatus().catch((err) => {
      console.error("status failed:", err);
      process.exit(1);
    });
    break;

  case "stop":
    void runStop().catch((err) => {
      console.error("stop failed:", err);
      process.exit(1);
    });
    break;

  default:
    printUsage();
    process.exit(command === "" ? 0 : 1);
}
