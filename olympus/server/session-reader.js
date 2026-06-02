import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readJson, tailLines } from "./io.js";

function readRecentPhaseEntries(root, maxEntries = 240) {
  const phaseDir = path.join(root, ".aegis", "logs", "phases");
  if (!existsSync(phaseDir)) return [];
  return readdirSync(phaseDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .slice(-maxEntries)
    .map((fileName) => ({ fileName, entry: readJson(path.join(phaseDir, fileName), null) }))
    .filter(({ entry }) => entry?.phase && entry?.action)
    .sort((left, right) => Date.parse(left.entry.timestamp ?? "") - Date.parse(right.entry.timestamp ?? ""));
}

function phaseEntryMatchesSession(entry, session) {
  if (!entry || !session?.id) return false;
  const issue = String(session.issue ?? "");
  const detail = String(entry.detail ?? "");
  return entry.sessionId === session.id
    || (issue && entry.issueId === issue)
    || detail.includes(session.id)
    || (issue && detail.includes(issue));
}

function formatSessionPhaseLine(entry) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour12: false }) : "";
  return [
    `[phase] ${time}`,
    entry.phase,
    entry.action,
    `status=${entry.outcome}`,
    entry.issueId && entry.issueId !== "_all" ? `issue=${entry.issueId}` : "",
    entry.sessionId ? `session=${entry.sessionId}` : "",
    entry.detail ? `detail=${summarizeBlock(entry.detail)}` : "",
  ].filter(Boolean).join(" ");
}

function readSessionActivityLines(root, session, maxLines = 80) {
  const lines = [];
  lines.push(...tailLines(path.join(root, ".aegis", "logs", "session-streams", `${session.id}.log`), maxLines));
  const report = readJson(path.join(root, ".aegis", "logs", "sessions", `${session.id}.json`), null);
  if (report?.status) lines.push(`[session] status=${report.status}`);
  if (report?.finishedAt) lines.push(`[session] finished=${report.finishedAt}`);
  if (report?.error) lines.push(`[error] ${summarizeBlock(report.error)}`);

  for (const { entry } of readRecentPhaseEntries(root)) {
    if (phaseEntryMatchesSession(entry, session)) lines.push(formatSessionPhaseLine(entry));
  }

  const daemonNeedles = [session.id, session.issue].filter(Boolean).map((value) => String(value).toLowerCase());
  if (daemonNeedles.length > 0) {
    for (const line of tailLines(path.join(root, ".aegis", "logs", "daemon.log"), 240)) {
      const lower = line.toLowerCase();
      if (daemonNeedles.some((needle) => lower.includes(needle))) lines.push(`[daemon] ${line}`);
    }
  }

  return dedupeLines(lines).slice(-maxLines);
}

function readSessionTranscripts(root) {
  const transcriptDir = path.join(root, ".aegis", "transcripts");
  if (!existsSync(transcriptDir)) return new Map();
  const transcripts = new Map();
  for (const fileName of readdirSync(transcriptDir).filter((entry) => entry.endsWith(".json"))) {
    const transcript = readJson(path.join(transcriptDir, fileName), null);
    if (!transcript?.sessionId) continue;
    if (transcript.provider === "scripted" || String(transcript.modelRef ?? "").startsWith("scripted:")) continue;
    transcripts.set(transcript.sessionId, {
      ...transcript,
      transcriptPath: path.join(".aegis", "transcripts", fileName).replace(/\\/g, "/"),
    });
  }
  return transcripts;
}

function linesFromTranscript(transcript, context = {}) {
  const lines = [
    `$ aegis session inspect ${transcript.sessionId}`,
    `# provider ${transcript.provider ?? "adapter"}`,
    `# model ${transcript.modelRef ?? transcript.modelId ?? "unknown"}`,
    `# thinking ${transcript.thinkingLevel ?? "unknown"}`,
    `# workingDirectory ${transcript.workingDirectory ?? "workspace"}`,
  ];

  if (Array.isArray(transcript?.terminalLog) && transcript.terminalLog.length > 0) {
    let inFinalBlock = false;
    let capturedFinalBlock = false;
    for (const line of transcript.terminalLog) {
      const rawLine = String(line ?? "").trimEnd();
      if (rawLine.trim() === "[final]") {
        inFinalBlock = true;
        capturedFinalBlock = false;
        continue;
      }
      if (inFinalBlock && !/^\s*(\[|\$|#)/.test(rawLine)) {
        if (!capturedFinalBlock) {
          lines.push(...formatFinalOutput(transcript.outputText || rawLine));
          capturedFinalBlock = true;
        }
        continue;
      }
      inFinalBlock = false;
      const formatted = formatTranscriptLine(line);
      if (Array.isArray(formatted)) lines.push(...formatted);
      else if (formatted) lines.push(formatted);
    }
  }

  for (const message of transcript.messageLog ?? []) {
    const role = message.role ?? "message";
    const content = String(message.content ?? "");
    if (role === "user" && content.includes("You are a dispatched Aegis caste subagent")) continue;
    const parsedContent = parseJsonBody(content);
    if (parsedContent) {
      if (role !== "assistant") lines.push(`[${role}] ${summarizeBlock(content)}`);
      continue;
    }
    const summary = summarizeBlock(content);
    if (summary) lines.push(`[${role}] ${summary}`);
  }
  if (transcript.outputText) lines.push(...formatFinalOutput(transcript.outputText));
  const error = context.error ?? transcript.error;
  if (error) lines.push(`[error] ${summarizeBlock(error)}`);
  return dedupeLines(lines);
}

function dedupeLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

function formatTranscriptLine(line) {
  const value = String(line ?? "").trimEnd();
  if (!value) return "";
  if (/^\[codex\]\s+(thread|turn|item)\./i.test(value)) return "";
  if (/^\[status\]\s+(item|turn)\.completed/i.test(value)) return "";
  if (value.includes("[final] {") || value.includes('{"files_affected"')) return ["[final] structured output captured"];
  if (value.startsWith("[final]")) return formatFinalOutput(value.replace(/^\[final\]\s*/, ""));
  if (value.trimStart().startsWith("{")) return formatFinalOutput(value);
  return value.length > 420 ? `${value.slice(0, 417)}...` : value;
}

function formatFinalOutput(outputText) {
  const text = String(outputText ?? "").trim().replace(/^\[final\]\s*/, "");
  if (!text) return [];
  const parsed = parseJsonBody(text);
  if (!parsed) return text.startsWith("{") || text.includes('{"files_affected"') ? ["[final] structured output captured"] : [`[final] ${summarizeBlock(text)}`];
  const lines = [];
  const outcome = parsed.outcome ?? parsed.status ?? parsed.verdict;
  if (outcome) lines.push(`[final] ${parsed.verdict ? "verdict" : "outcome"}=${outcome}`);
  if (parsed.summary) lines.push(`[summary] ${summarizeBlock(parsed.summary)}`);
  if (parsed.reviewSummary) lines.push(`[review] ${summarizeBlock(parsed.reviewSummary)}`);
  if (Array.isArray(parsed.blockingFindings)) {
    for (const finding of parsed.blockingFindings.slice(0, 3)) {
      lines.push(`[finding] ${summarizeBlock(formatFinding(finding))}`);
    }
  }
  if (Array.isArray(parsed.files_changed)) lines.push(`[files] changed=${parsed.files_changed.length}`);
  if (Array.isArray(parsed.files_affected)) lines.push(`[files] affected=${parsed.files_affected.length}`);
  if (parsed.estimated_complexity) lines.push(`[scope] complexity=${parsed.estimated_complexity}`);
  if (Array.isArray(parsed.checks) && parsed.checks.length) lines.push(`[checks] ${summarizeBlock(parsed.checks.join("; "))}`);
  if (Array.isArray(parsed.suggested_checks) && parsed.suggested_checks.length) lines.push(`[checks] ${summarizeBlock(parsed.suggested_checks.join("; "))}`);
  if (Array.isArray(parsed.known_risks) && parsed.known_risks.length) lines.push(`[risks] ${summarizeBlock(parsed.known_risks.join("; "))}`);
  if (Array.isArray(parsed.risks) && parsed.risks.length) lines.push(`[risks] ${summarizeBlock(parsed.risks.join("; "))}`);
  if (parsed.mutation_proposal) lines.push(`[proposal] ${summarizeBlock(formatValue(parsed.mutation_proposal))}`);
  return lines.length ? lines : [`[final] ${summarizeBlock(text)}`];
}

function summarizeBlock(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 520);
}

function formatValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatFinding(finding) {
  if (!finding || typeof finding !== "object") return finding;
  return [finding.finding_kind, finding.route, finding.owner_issue, finding.summary].filter(Boolean).join(" - ");
}

function parseJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function transcriptControlStatus(transcript) {
  const parsed = parseJsonBody(transcript?.outputText ?? "");
  const value = String(parsed?.outcome ?? parsed?.status ?? parsed?.verdict ?? "").toLowerCase();
  if (["fail_blocking", "blocked", "blocked_on_child"].includes(value)) return "blocked";
  if (["failure", "failed", "error", "rejected"].includes(value)) return "failed";
  if (["success", "succeeded", "pass", "passed", "accepted"].includes(value)) return "succeeded";
  return "";
}

function sessionFromTranscript(transcript, existing = null) {
  const controlStatus = transcriptControlStatus(transcript);
  const status = existing?.status === "failed" || transcript.status === "failed" || controlStatus === "failed"
    ? "failed"
    : controlStatus || transcript.status || existing?.status || "unknown";
  const error = existing?.error ?? transcript.error ?? "";
  return {
    id: transcript.sessionId,
    caste: transcript.caste ? transcript.caste.replace(/^\w/, (letter) => letter.toUpperCase()) : existing?.caste ?? "Agent",
    issue: transcript.issueId ?? existing?.issue ?? "unbound",
    stage: transcript.action ?? existing?.stage ?? "session",
    status,
    adapter: transcript.provider ?? existing?.adapter ?? "adapter",
    cwd: transcript.workingDirectory ?? existing?.cwd ?? "workspace",
    activity: transcript.transcriptPath ?? existing?.activity ?? "transcript",
    error,
    lines: linesFromTranscript(transcript, { error }),
  };
}

export function readSessions(root, records) {
  const sessionsById = new Map();
  const transcriptsBySessionId = readSessionTranscripts(root);
  const failureByTranscript = new Map();
  for (const record of records) {
    if (record?.stage !== "failed_operational" || !record.failureTranscriptRef) continue;
    failureByTranscript.set(normalizeRef(record.failureTranscriptRef), record);
  }
  for (const record of records) {
    if (!record?.runningAgent?.sessionId) continue;
    const sessionId = record.runningAgent.sessionId;
    const transcript = transcriptsBySessionId.get(sessionId);
    const session = {
      id: sessionId,
      caste: record.runningAgent.caste?.replace(/^\w/, (letter) => letter.toUpperCase()) ?? "Agent",
      issue: record.issueId,
      stage: record.stage,
      status: "running",
      adapter: "adapter",
      cwd: record.fileScope?.files?.join(", ") || "workspace",
      activity: record.updatedAt ? `state updated ${record.updatedAt}` : "state active",
      lines: [],
    };
    const liveLines = readSessionActivityLines(root, session);
    session.lines = [
      `$ aegis session inspect ${sessionId}`,
      `[adapter] ${record.runningAgent.caste ?? "agent"}`,
      `[issue] ${record.issueId}`,
      `[stage] ${record.stage}`,
      "[status] running",
      ...(liveLines.length ? liveLines : ["[stream] waiting for durable session events"]),
    ];
    sessionsById.set(sessionId, transcript ? sessionFromTranscript(transcript, session) : session);
  }

  addSessionReports(root, sessionsById, transcriptsBySessionId);
  addTranscriptOnlySessions(sessionsById, transcriptsBySessionId, failureByTranscript);
  return [...sessionsById.values()].sort((left, right) =>
    String(left.issue).localeCompare(String(right.issue))
    || String(left.caste).localeCompare(String(right.caste))
    || String(left.id).localeCompare(String(right.id)));
}

function addSessionReports(root, sessionsById, transcriptsBySessionId) {
  const sessionDir = path.join(root, ".aegis", "logs", "sessions");
  if (!existsSync(sessionDir)) return;
  for (const fileName of readdirSync(sessionDir).filter((entry) => entry.endsWith(".json"))) {
    const report = readJson(path.join(sessionDir, fileName), null);
    if (!report?.sessionId) continue;
    const existing = sessionsById.get(report.sessionId);
    const transcript = transcriptsBySessionId.get(report.sessionId);
    const reportStatus = report.status === "failed" || existing?.status === "failed" ? "failed" : report.status ?? existing?.status ?? "unknown";
    const reportError = report.error ?? existing?.error ?? "";
    if (!existing && !transcript && !report.issueId && !report.caste) continue;
    const reported = {
      ...(existing ?? {
        id: report.sessionId,
        caste: "Agent",
        issue: "unbound",
        stage: "session",
        adapter: "adapter",
        cwd: "workspace",
        activity: "session report available",
        lines: [`$ aegis session inspect ${report.sessionId}`],
      }),
      status: reportStatus,
      error: reportError,
      activity: reportError || report.finishedAt || existing?.activity || "session report available",
    };
    const liveLines = readSessionActivityLines(root, reported);
    reported.lines = dedupeLines([
      ...(existing?.lines ?? [`$ aegis session inspect ${report.sessionId}`]),
      ...liveLines,
      `[status] ${reportStatus}`,
      ...(report.finishedAt ? [`[finished] ${report.finishedAt}`] : []),
      ...(reportError ? [`[error] ${summarizeBlock(reportError)}`] : []),
    ]);
    sessionsById.set(report.sessionId, transcript ? sessionFromTranscript(transcript, reported) : reported);
  }
}

function addTranscriptOnlySessions(sessionsById, transcriptsBySessionId, failureByTranscript) {
  for (const [sessionId, transcript] of transcriptsBySessionId) {
    const failure = failureByTranscript.get(normalizeRef(transcript.transcriptPath));
    if (failure) {
      const existing = sessionsById.get(sessionId);
      sessionsById.set(sessionId, sessionFromTranscript(transcript, {
        ...existing,
        id: sessionId,
        issue: failure.issueId ?? existing?.issue,
        stage: failure.stage ?? existing?.stage,
        status: "failed",
        error: failure.operationalFailureKind ?? existing?.error ?? "operational failure",
        activity: failure.failureTranscriptRef ?? existing?.activity,
      }));
    } else if (!sessionsById.has(sessionId)) {
      sessionsById.set(sessionId, sessionFromTranscript(transcript));
    }
  }
}

function normalizeRef(value) {
  return String(value ?? "").replace(/\\/g, "/");
}
