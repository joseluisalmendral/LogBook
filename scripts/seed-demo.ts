#!/usr/bin/env tsx
/**
 * scripts/seed-demo.ts — Generate a realistic demo HTML for visual inspection.
 *
 * Creates a fresh temp project, writes ~40 realistic events.jsonl entries
 * spread across multiple sessions, decisions, errors, lessons, milestones,
 * and resources, then runs `logbook build` + `logbook export html`.
 *
 * Usage:
 *   pnpm tsx scripts/seed-demo.ts
 *
 * Output: prints the absolute path of the generated HTML file.
 */

import { execSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a ULID-like id (not spec-compliant but good enough for demo). */
function uid(prefix = ""): string {
  const ts = Date.now().toString(36).toUpperCase().padStart(10, "0");
  const rand = randomBytes(8).toString("hex").toUpperCase().slice(0, 6);
  return `${prefix}${ts}${rand}`;
}

/** ISO timestamp offset from a base date by +hours. */
function ts(base: Date, plusHoursFloat: number): string {
  const d = new Date(base.getTime() + plusHoursFloat * 3_600_000);
  return d.toISOString();
}

function runIn(dir: string, cmd: string, label: string, env?: NodeJS.ProcessEnv): void {
  console.log(`  [${label}] ${cmd}`);
  try {
    execSync(cmd, {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, ...env },
    });
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const out = e.stdout?.toString() ?? "";
    const errTxt = e.stderr?.toString() ?? e.message ?? String(err);
    console.error(`  ✗ FAILED: ${label}\n${out}\n${errTxt}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Build events
// ---------------------------------------------------------------------------

// Spread sessions across 3 weeks starting 2026-04-28.
const week1 = new Date("2026-04-28T09:00:00Z");
const week2 = new Date("2026-05-05T09:00:00Z");
const week3 = new Date("2026-05-12T09:00:00Z");

const S1 = uid("S1");
const S2 = uid("S2");
const S3 = uid("S3");
const S4 = uid("S4");

type EventObj = Record<string, unknown>;

const events: EventObj[] = [];

// ---- Session 1: bootstrap + architecture decisions -------------------------
events.push({
  id: uid(),
  type: "manual.session_start",
  ts: ts(week1, 0),
  sessionId: S1,
  label: "Week 1 – Project bootstrap",
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week1, 0.1),
  sessionId: S1,
  tool_name: "Bash",
  tool_input: { command: "git init && pnpm init" },
});

const D1 = uid();
events.push({
  id: D1,
  type: "manual.decision",
  ts: ts(week1, 0.5),
  sessionId: S1,
  title: "Use TypeScript strict mode",
  phase: "Architecture",
  status: "accepted",
  rationale: "Strict mode catches null-safety issues at compile time. Reduces runtime errors by ~40% based on team experience.",
  alternatives: "lenient TS config, plain JS",
  chosen: "TypeScript strict",
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week1, 0.8),
  sessionId: S1,
  tool_name: "Edit",
  tool_input: { file_path: "tsconfig.json" },
});

const D2 = uid();
events.push({
  id: D2,
  type: "manual.decision",
  ts: ts(week1, 1.2),
  sessionId: S1,
  title: "Adopt Hexagonal Architecture",
  phase: "Architecture",
  status: "accepted",
  rationale: "Separates domain logic from infrastructure. Makes the core testable without DB or HTTP setup.",
  alternatives: "Layered architecture, flat modules",
  chosen: "Hexagonal with ports and adapters",
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week1, 1.5),
  sessionId: S1,
  tool_name: "Read",
  tool_input: { file_path: "src/domain/index.ts" },
});

const D3 = uid();
events.push({
  id: D3,
  type: "manual.decision",
  ts: ts(week1, 2),
  sessionId: S1,
  title: "Use JSONL for event persistence",
  phase: "Persistence",
  status: "accepted",
  rationale: "Append-only, human-readable, zero schema migrations. Stream-parseable. Fits our write-once read-many workload.",
  alternatives: "SQLite only, PostgreSQL, flat JSON files",
  chosen: "JSONL append-only",
});

const L1 = uid();
events.push({
  id: L1,
  type: "manual.lesson",
  ts: ts(week1, 2.5),
  sessionId: S1,
  title: "Never accept HOME as project root",
  body: "Logbook's resolveProjectRoot walked up past the repo and found ~/.git (dotfiles). It installed into $HOME silently. Added an explicit HOME boundary check.",
  tags: ["install", "safety", "paths"],
  severity: "blocker",
});

events.push({
  id: uid(),
  type: "manual.milestone",
  ts: ts(week1, 3),
  sessionId: S1,
  title: "Architecture baseline complete",
  description: "Core domain model, persistence strategy, and folder structure agreed upon.",
  phase: "Architecture",
});

// ---- Session 2: implementation + first errors ------------------------------
events.push({
  id: uid(),
  type: "manual.session_start",
  ts: ts(week1, 24),
  sessionId: S2,
  label: "Week 1 day 2 – DB layer",
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week1, 24.2),
  sessionId: S2,
  tool_name: "Bash",
  tool_input: { command: "pnpm add better-sqlite3" },
});

const E1 = uid();
events.push({
  id: E1,
  type: "manual.error",
  ts: ts(week1, 24.5),
  sessionId: S2,
  title: "SQLite file-locking race on concurrent writes",
  message: "SQLITE_BUSY: database is locked — triggered under parallel test runs",
  severity: "high",
  status: "open",
});

const F1 = uid();
events.push({
  id: F1,
  type: "manual.fix",
  ts: ts(week1, 25),
  sessionId: S2,
  errorId: E1,
  title: "Add WAL mode + retry loop",
  description: "Set PRAGMA journal_mode=WAL and added a 5-retry backoff in the write path. Resolved SQLITE_BUSY under load.",
  verified: true,
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week1, 25.3),
  sessionId: S2,
  tool_name: "Edit",
  tool_input: { file_path: "src/db/connection.ts" },
});

const L2 = uid();
events.push({
  id: L2,
  type: "manual.lesson",
  ts: ts(week1, 25.5),
  sessionId: S2,
  title: "WAL mode is not enough for parallel tests",
  body: "Parallel vitest workers each open their own SQLite connection. WAL helps but a retry + random jitter is needed to avoid flaky CI.",
  tags: ["db", "sqlite", "testing"],
  severity: "info",
});

const D4 = uid();
events.push({
  id: D4,
  type: "manual.decision",
  ts: ts(week1, 26),
  sessionId: S2,
  title: "Use file-lock (proper-lockfile) on JSONL appends",
  phase: "Persistence",
  status: "accepted",
  rationale: "Multiple Claude Code sessions can run in parallel. JSONL appends must be serialized to avoid interleaved writes.",
  alternatives: "SQLite mutex, optimistic retry",
  chosen: "proper-lockfile around JSONL append",
});

events.push({
  id: uid(),
  type: "manual.resource",
  ts: ts(week1, 26.5),
  sessionId: S2,
  kind: "url",
  uri: "https://sqlite.org/wal.html",
  title: "SQLite WAL mode documentation",
  tags: ["db", "sqlite", "perf"],
});

// ---- Session 3: auth + security work ----------------------------------------
events.push({
  id: uid(),
  type: "manual.session_start",
  ts: ts(week2, 0),
  sessionId: S3,
  label: "Week 2 – Auth & security hardening",
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week2, 0.3),
  sessionId: S3,
  tool_name: "Read",
  tool_input: { file_path: "src/auth/middleware.ts" },
});

const E2 = uid();
events.push({
  id: E2,
  type: "manual.error",
  ts: ts(week2, 1),
  sessionId: S3,
  title: "JWT tokens exposed in server logs",
  message: "Access tokens were being logged at DEBUG level via the request interceptor",
  severity: "critical",
  status: "open",
});

const F2 = uid();
events.push({
  id: F2,
  type: "manual.fix",
  ts: ts(week2, 1.5),
  sessionId: S3,
  errorId: E2,
  title: "Redact Authorization header before logging",
  description: "Added a log sanitizer that replaces Bearer <token> with Bearer [REDACTED] in all log calls.",
  verified: true,
});

const L3 = uid();
events.push({
  id: L3,
  type: "manual.lesson",
  ts: ts(week2, 2),
  sessionId: S3,
  title: "Never log raw request headers",
  body: "Default HTTP logging middleware often dumps full headers. Always configure a redact list for Authorization, Cookie, and X-API-Key headers before enabling request logging.",
  tags: ["auth", "security", "logging"],
  severity: "blocker",
});

const D5 = uid();
events.push({
  id: D5,
  type: "manual.decision",
  ts: ts(week2, 2.5),
  sessionId: S3,
  title: "Validate all MCP tool inputs with valibot",
  phase: "Security",
  status: "accepted",
  rationale: "MCP tools receive external input from LLMs. Schema validation prevents injection via malformed tool calls.",
  alternatives: "zod, manual checks, none",
  chosen: "valibot (smaller bundle, same expressiveness)",
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week2, 2.8),
  sessionId: S3,
  tool_name: "Bash",
  tool_input: { command: "pnpm add valibot" },
});

events.push({
  id: uid(),
  type: "manual.resource",
  ts: ts(week2, 3),
  sessionId: S3,
  kind: "url",
  uri: "https://valibot.dev/guides/introduction/",
  title: "Valibot quickstart guide",
  tags: ["validation", "security"],
});

events.push({
  id: uid(),
  type: "manual.resource",
  ts: ts(week2, 3.5),
  sessionId: S3,
  kind: "snippet",
  uri: "src/mcp/validate.ts#L1-L40",
  title: "Valibot schema for tool inputs",
  tags: ["validation", "mcp"],
});

const E3 = uid();
events.push({
  id: E3,
  type: "manual.error",
  ts: ts(week2, 4),
  sessionId: S3,
  title: "Path traversal in MCP file tool",
  message: "Tool allowed paths outside project root via ../ sequences",
  severity: "critical",
  status: "open",
});

const F3 = uid();
events.push({
  id: F3,
  type: "manual.fix",
  ts: ts(week2, 4.5),
  sessionId: S3,
  errorId: E3,
  title: "Confine all paths to project root with realpath check",
  description: "resolveAndConfine() checks that realpath(input) starts with realpath(projectRoot). Throws PathConfinementError otherwise.",
  verified: true,
});

events.push({
  id: uid(),
  type: "manual.milestone",
  ts: ts(week2, 5),
  sessionId: S3,
  title: "Security audit passed",
  description: "All 3 critical issues resolved. Path confinement + input validation + log redaction in place.",
  phase: "Security",
});

// ---- Session C: conversation capture showcase (new event kinds) --------------
// This session exercises all new event kinds introduced in the conversation-capture
// slice: user_prompt, claude_message (text + thinking), tool_use.*, tool_result.*,
// subagent_complete, manual.decision, manual.annotation, manual.session_goal,
// manual.session_outcome.
const SC = uid("SC");
const weekC = new Date("2026-05-20T10:00:00Z");

// Session start with label so sessions-doc renders a meaningful header.
events.push({
  id: uid(),
  type: "manual.session_start",
  ts: ts(weekC, -0.5 / 60), // just before the goal event
  sessionId: SC,
  label: "Conversation capture — teaching slice",
});

events.push({
  id: uid(),
  kind: "user_entry",
  timestamp: ts(weekC, 0),
  sessionId: SC,
  payload: {
    entryType: "session_goal",
    text: "Ship full conversation timeline with goal/outcome + annotations.",
  },
});

events.push({
  id: uid(),
  kind: "user_prompt",
  timestamp: ts(weekC, 1 / 60),
  sessionId: SC,
  payload: {
    text: "Implement the conversation capture slice per the teaching audit.",
  },
});

events.push({
  id: uid(),
  kind: "claude_message",
  timestamp: ts(weekC, 2 / 60),
  sessionId: SC,
  payload: {
    text: "I'll start by checking the existing render-context bug.",
  },
});

events.push({
  id: uid(),
  kind: "claude_message",
  timestamp: ts(weekC, 3 / 60),
  sessionId: SC,
  payload: {
    text: "The audit identified render-context.ts:176-185 as the drop point for events without synthesized type. I need to extend the else branch.",
    isThinking: true,
  },
});

events.push({
  id: uid(),
  kind: "tool_use",
  timestamp: ts(weekC, 4 / 60),
  sessionId: SC,
  payload: {
    tool_name: "Read",
    tool_args: { file_path: "src/generate/render-context.ts" },
  },
});

events.push({
  id: uid(),
  kind: "tool_result",
  timestamp: ts(weekC, 5 / 60),
  sessionId: SC,
  payload: {
    tool_name: "Read",
    tool_response: "File read successfully. Lines 92-109 contain the synthesis block.",
  },
});

events.push({
  id: uid(),
  kind: "claude_message",
  timestamp: ts(weekC, 6 / 60),
  sessionId: SC,
  payload: {
    text: "Found the synthesis gap. Now adding the new kinds: user_prompt, claude_message, subagent_complete, tool_use.*, tool_result.*, hook.*.",
  },
});

events.push({
  id: uid(),
  kind: "tool_use",
  timestamp: ts(weekC, 7 / 60),
  sessionId: SC,
  payload: {
    tool_name: "Edit",
    tool_args: { file_path: "src/generate/render-context.ts" },
  },
});

events.push({
  id: uid(),
  kind: "tool_result",
  timestamp: ts(weekC, 8 / 60),
  sessionId: SC,
  payload: {
    tool_name: "Edit",
    tool_response: "File updated successfully.",
  },
});

const DC1 = uid();
events.push({
  id: DC1,
  kind: "user_entry",
  timestamp: ts(weekC, 9 / 60),
  sessionId: SC,
  payload: {
    entryType: "decision",
    title: "Synthesize tool_use/tool_result types in read-path, not write-path",
    rationale: "JSONL is append-only audit log; migrations require full rewrites. Read-path keeps writers untouched.",
    status: "accepted",
  },
});

events.push({
  id: uid(),
  kind: "user_entry",
  timestamp: ts(weekC, 10 / 60),
  sessionId: SC,
  payload: {
    entryType: "annotation",
    relatedEventId: DC1,
    note: "Pinned because reviewers will ask why we didn't migrate JSONL. ADR-1 explains the tradeoff.",
  },
});

events.push({
  id: uid(),
  kind: "tool_use",
  timestamp: ts(weekC, 11 / 60),
  sessionId: SC,
  payload: {
    tool_name: "Task",
    tool_args: { description: "Implement transcript scraper sub-agent" },
  },
});

const SA1_AGENT_ID = uid("AGENT");
events.push({
  id: uid(),
  kind: "claude_message",
  timestamp: ts(weekC, 15 / 60),
  sessionId: SC,
  payload: {
    text: "Transcript scraper implementation complete. pathToEncoded verified against real path.",
  },
  meta: {
    subagentId: SA1_AGENT_ID,
    isSidechain: true,
    attributionAgent: "sdd-apply",
  },
});

events.push({
  id: uid(),
  kind: "subagent_complete",
  timestamp: ts(weekC, 20 / 60),
  sessionId: SC,
  payload: {
    agentId: SA1_AGENT_ID,
    attributionAgent: "sdd-apply",
    toolCallCount: 4,
    durationMs: 42_000,
  },
});

events.push({
  id: uid(),
  kind: "tool_use",
  timestamp: ts(weekC, 21 / 60),
  sessionId: SC,
  payload: {
    tool_name: "Bash",
    tool_args: { command: "pnpm typecheck" },
  },
});

events.push({
  id: uid(),
  kind: "tool_result",
  timestamp: ts(weekC, 25 / 60),
  sessionId: SC,
  payload: {
    tool_name: "Bash",
    tool_response: "1 error: render-context.ts:107 — hook_event_name property missing from synthesized type.",
    error: true,
  },
});

events.push({
  id: uid(),
  kind: "user_entry",
  timestamp: ts(weekC, 26 / 60),
  sessionId: SC,
  payload: {
    entryType: "error",
    title: "Synthesis precedence wrong for hook_event_name",
    message: "The hook_event branch reads merged.hook_event_name but the field is in merged.meta.hook after flatten.",
    severity: "high",
  },
});

events.push({
  id: uid(),
  kind: "user_entry",
  timestamp: ts(weekC, 27 / 60),
  sessionId: SC,
  payload: {
    entryType: "fix",
    title: "Read both merged.hook_event_name and merged.hook for the hook branch",
    description: "const hookEventName = merged['hook_event_name'] ?? merged['hook']; — covers both flattened and non-flattened payloads.",
  },
});

events.push({
  id: uid(),
  kind: "tool_use",
  timestamp: ts(weekC, 28 / 60),
  sessionId: SC,
  payload: {
    tool_name: "Bash",
    tool_args: { command: "pnpm typecheck" },
  },
});

events.push({
  id: uid(),
  kind: "tool_result",
  timestamp: ts(weekC, 32 / 60),
  sessionId: SC,
  payload: {
    tool_name: "Bash",
    tool_response: "Type check passed. No errors.",
  },
});

events.push({
  id: uid(),
  kind: "user_entry",
  timestamp: ts(weekC, 33 / 60),
  sessionId: SC,
  payload: {
    entryType: "session_outcome",
    text: "All hooks p95<200ms, 0 redactions fired, 1500 LoC, sessions doc renders rich timeline.",
  },
});

// ---- Session UX: new capture surfaces showcase (W12 seed — 5 new event kinds) --
// Shows all 5 new capture surfaces introduced by the ux-granularity-and-capture-gaps
// slice: langfuse_trace (B1), gh_agent_run (B2), skill_invoked (B3),
// visual_direction (B4), qa_finding (B5).
const S_UX = uid("SUX");
const weekUX = new Date("2026-05-19T14:00:00Z");

events.push({
  id: uid(),
  type: "manual.session_start",
  ts: ts(weekUX, 0),
  sessionId: S_UX,
  label: "UX Granularity — new capture surfaces demo",
});

// B1: langfuse_trace — captured from Stop hook after LLM session.
events.push({
  id: uid(),
  type: "langfuse_trace",
  ts: ts(weekUX, 0.5),
  sessionId: S_UX,
  traceId: "trace-demo-001",
  model: "claude-3-5-sonnet-20241022",
  inputTokens: 8240,
  outputTokens: 1680,
  totalTokens: 9920,
  costUsd: 0.0312,
  startedAt: ts(weekUX, 0.1),
});

// B3: skill_invoked — detected from SKILL.md read in transcript scraper.
events.push({
  id: uid(),
  type: "skill_invoked",
  ts: ts(weekUX, 0.6),
  sessionId: S_UX,
  skillName: "sdd-apply",
  skillPath: "/project/.claude/skills/sdd-apply/SKILL.md",
});

// B2: gh_agent_run — imported via `logbook import github-pr`.
events.push({
  id: uid(),
  type: "gh_agent_run",
  ts: ts(weekUX, 1.0),
  sessionId: S_UX,
  prUrl: "https://github.com/thepower/logbook/pull/42",
  prNumber: 42,
  runId: "run-gh-001",
  runSummary: "Fixed CORS headers on the API gateway. Updated nginx config and regenerated certs.",
  filesChanged: 5,
});

// B4: visual_direction — logged via `logbook visual-direction`.
events.push({
  id: uid(),
  type: "visual_direction",
  ts: ts(weekUX, 1.5),
  sessionId: S_UX,
  candidates: ["dark-minimal", "light-colorful", "branded-gradient"],
  chosen: "dark-minimal",
  rationale: "Aligns with brand identity, passes WCAG AA contrast, and reduces cognitive load during debugging sessions.",
});

// B5: qa_finding — logged via logbook_qa_finding MCP tool.
events.push({
  id: uid(),
  type: "qa_finding",
  ts: ts(weekUX, 2.0),
  sessionId: S_UX,
  severity: "high",
  layer: "seo",
  description: "Product listing pages missing canonical URL. Duplicate content penalty risk for paginated routes.",
  fix: "Add <link rel='canonical' href='...'> to /products?page=N routes pointing to /products.",
});

events.push({
  id: uid(),
  type: "qa_finding",
  ts: ts(weekUX, 2.2),
  sessionId: S_UX,
  severity: "medium",
  layer: "a11y",
  description: "Mobile navigation hamburger button lacks aria-label and aria-expanded attributes.",
  // fix intentionally absent to exercise the "—" render path (B5-R5)
});

events.push({
  id: uid(),
  type: "qa_finding",
  ts: ts(weekUX, 2.4),
  sessionId: S_UX,
  severity: "critical",
  layer: "perf",
  description: "First Contentful Paint exceeds 4s on 3G. Main thread blocked by 280KB uncompressed JS bundle.",
  fix: "Enable Brotli compression on CDN. Code-split vendor bundle. Target FCP < 1.8s.",
});

// ---- Session 4: UI + export polish ------------------------------------------
events.push({
  id: uid(),
  type: "manual.session_start",
  ts: ts(week3, 0),
  sessionId: S4,
  label: "Week 3 – UI polish + export",
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week3, 0.2),
  sessionId: S4,
  tool_name: "Read",
  tool_input: { file_path: "assets/export/styles.css" },
});

const D6 = uid();
events.push({
  id: D6,
  type: "manual.decision",
  ts: ts(week3, 0.5),
  sessionId: S4,
  title: "Use raw HTML tables instead of GFM pipe-tables in generators",
  phase: "Export",
  status: "accepted",
  rationale: "remark-parse without remark-gfm does not render GFM pipe-tables. Raw HTML tables pass through the placeholder pipeline unchanged.",
  alternatives: "add remark-gfm dependency, use dl/dt/dd lists",
  chosen: "raw HTML <table> via buildHtmlTable() helper",
});

const L4 = uid();
events.push({
  id: L4,
  type: "manual.lesson",
  ts: ts(week3, 1),
  sessionId: S4,
  title: "remark-parse does not parse GFM tables without remark-gfm",
  body: "Pipe-table syntax (| col | col |) is GFM — not in the core CommonMark spec. remark-parse alone produces plain text. Either add remark-gfm or switch to raw HTML tables.",
  tags: ["markdown", "remark", "gfm", "tables"],
  severity: "blocker",
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week3, 1.3),
  sessionId: S4,
  tool_name: "Edit",
  tool_input: { file_path: "src/generate/sessions-doc.ts" },
});

events.push({
  id: uid(),
  type: "hook_event",
  ts: ts(week3, 1.6),
  sessionId: S4,
  tool_name: "Edit",
  tool_input: { file_path: "src/generate/decisions-doc.ts" },
});

const L5 = uid();
events.push({
  id: L5,
  type: "manual.lesson",
  ts: ts(week3, 2),
  sessionId: S4,
  title: "HTML placeholder pattern must cover all block-level tags",
  body: "The LBRAW_<n> placeholder mechanism needs to explicitly list every block-level tag the generators emit. Missing a tag (e.g. 'select') causes it to be stripped by remark-rehype without allowDangerousHtml.",
  tags: ["html", "remark", "export", "pipeline"],
  severity: "info",
});

events.push({
  id: uid(),
  type: "manual.resource",
  ts: ts(week3, 2.5),
  sessionId: S4,
  kind: "url",
  uri: "https://unifiedjs.com/explore/package/remark-rehype/",
  title: "remark-rehype — allowDangerousHtml option",
  tags: ["markdown", "remark", "export"],
});

events.push({
  id: uid(),
  type: "manual.resource",
  ts: ts(week3, 3),
  sessionId: S4,
  kind: "file",
  uri: "assets/export/styles.css",
  title: "Main export stylesheet",
  tags: ["css", "ui", "export"],
});

const D7 = uid();
events.push({
  id: D7,
  type: "manual.decision",
  ts: ts(week3, 3.5),
  sessionId: S4,
  title: "Dark mode via CSS custom properties and prefers-color-scheme",
  phase: "UI",
  status: "accepted",
  rationale: "Native CSS dark mode with no JS required. Variables make it trivial to switch the entire palette in one block.",
  alternatives: "class-based dark mode (JS toggle only), no dark mode",
  chosen: "prefers-color-scheme media query + JS toggle as enhancement",
});

events.push({
  id: uid(),
  type: "manual.milestone",
  ts: ts(week3, 4),
  sessionId: S4,
  title: "v1.0 export ready",
  description: "HTML export with 9 sections, dark mode, interactive filters, and correct table rendering shipped.",
  phase: "Export",
});

events.push({
  id: uid(),
  type: "manual.resource",
  ts: ts(week3, 4.5),
  sessionId: S4,
  kind: "url",
  uri: "https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties",
  title: "MDN: CSS Custom Properties",
  tags: ["css", "dark-mode", "ui"],
});

const E4 = uid();
events.push({
  id: E4,
  type: "manual.error",
  ts: ts(week3, 5),
  sessionId: S4,
  title: "localStorage key mismatch in theme toggle",
  message: "JS used 'lb-theme' but spec says 'lb.theme' — dark mode preference not persisted",
  severity: "low",
  status: "open",
});

const F4 = uid();
events.push({
  id: F4,
  type: "manual.fix",
  ts: ts(week3, 5.3),
  sessionId: S4,
  errorId: E4,
  title: "Align localStorage key to spec lb.theme",
  description: "Changed all getItem/setItem calls from 'lb-theme' to 'lb.theme' per spec IJ-4.",
  verified: true,
});

// ---------------------------------------------------------------------------
// Write events.jsonl + initialize and run logbook
// ---------------------------------------------------------------------------

const DEMO_DIR = join(tmpdir(), `logbook-demo-${Date.now()}`);
// .logbook/ is the private state dir (state.json, index.sqlite, etc.)
// logbook/evidence/ is where events.jsonl lives (the build reads from here)
const DOTLOGBOOK_DIR = join(DEMO_DIR, ".logbook");
const EVIDENCE_DIR = join(DEMO_DIR, "logbook", "evidence");
const DOCS_DIR = join(DEMO_DIR, "logbook", "docs");
const EXPORTS_DIR = join(DEMO_DIR, "logbook", "exports");
const EVENTS_FILE = join(EVIDENCE_DIR, "events.jsonl");
const OUT_HTML = join(EXPORTS_DIR, "index.html");

// Absolute path to the CLI bundle
// Use fileURLToPath to handle URL-encoded spaces in the path correctly.
const { fileURLToPath } = await import("node:url");
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(REPO_ROOT, "dist", "cli", "index.cjs");

console.log(`\n=== LogBook Demo Seed ===`);
console.log(`Demo dir: ${DEMO_DIR}\n`);

// Create directory structure
mkdirSync(DOTLOGBOOK_DIR, { recursive: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });
mkdirSync(DOCS_DIR, { recursive: true });
mkdirSync(EXPORTS_DIR, { recursive: true });

// Create a minimal git repo so resolveProjectRoot finds a root
runIn(DEMO_DIR, "git init -q", "git init");
runIn(DEMO_DIR, "touch .gitkeep && git add . && git -c user.email=demo@demo.com -c user.name=Demo commit -q -m 'init'", "git commit");

// Write events.jsonl
writeFileSync(EVENTS_FILE, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`  Wrote ${events.length} events to ${EVENTS_FILE}`);

// Run logbook build (reads events.jsonl, writes logbook/docs/*)
console.log("\n--- logbook build ---");
runIn(DEMO_DIR, `node "${CLI}" build`, "build");

// Strip mermaid fences from generated docs before export.
// Rationale: the mock SVG (LOGBOOK_MERMAID_MOCK=1) contains xmlns="http://www.w3.org/2000/svg"
// which the sanitizer correctly catches as a non-HTTPS external URL, causing the export
// to throw. Real mmdc is not required in a demo seed — text content is sufficient.
// Mermaid diagrams are exercised by the tests and the manual visual gate (Phase 7.5).
console.log("\n--- stripping mermaid fences from docs ---");
const docsFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
for (const f of docsFiles) {
  const filePath = join(DOCS_DIR, f);
  const original = readFileSync(filePath, "utf8");
  // Remove ```mermaid ... ``` blocks (multi-line).
  const stripped = original.replace(/```mermaid\n[\s\S]*?\n```\n?/g, "");
  if (stripped !== original) {
    writeFileSync(filePath, stripped, "utf8");
    console.log(`  Stripped mermaid from ${f}`);
  }
}

// Run logbook export html
console.log("\n--- logbook export html ---");
runIn(DEMO_DIR, `node "${CLI}" export html`, "export html");

// Verify output
if (!existsSync(OUT_HTML)) {
  console.error(`\n✗ HTML not found at expected path: ${OUT_HTML}`);
  process.exit(1);
}

const size = (await import("node:fs/promises").then((m) => m.stat(OUT_HTML))).size;
console.log(`\n=== DONE ===`);
console.log(`HTML path : ${OUT_HTML}`);
console.log(`File size : ${size} bytes (${Math.round(size / 1024)} KB)`);
console.log(`Events        : ${events.length} total`);
console.log(`Sessions      : 6 (S1-S4 + SC conversation-capture + S_UX new-capture-surfaces)`);
console.log(`Decisions     : ${events.filter((e) => e["type"] === "manual.decision").length}`);
console.log(`Errors        : ${events.filter((e) => e["type"] === "manual.error").length}`);
console.log(`Lessons       : ${events.filter((e) => e["type"] === "manual.lesson").length}`);
console.log(`Resources     : ${events.filter((e) => e["type"] === "manual.resource").length}`);
console.log(`Milestones    : ${events.filter((e) => e["type"] === "manual.milestone").length}`);
console.log(`langfuse_trace: ${events.filter((e) => e["type"] === "langfuse_trace").length}`);
console.log(`gh_agent_run  : ${events.filter((e) => e["type"] === "gh_agent_run").length}`);
console.log(`skill_invoked : ${events.filter((e) => e["type"] === "skill_invoked").length}`);
console.log(`visual_dir    : ${events.filter((e) => e["type"] === "visual_direction").length}`);
console.log(`qa_finding    : ${events.filter((e) => e["type"] === "qa_finding").length}`);
