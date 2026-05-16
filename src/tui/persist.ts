/**
 * persist.ts — Side-effect orchestrator for the shell TUI (iter6 T5).
 *
 * Bridges shell actions to existing core modules:
 *   buildSnapshot  — reads manifest + state + token breakdown + events
 *   runInstallAction — calls runInstall
 *   runUninstallAction — calls runUninstall
 *   runBuildAction — calls runAllGenerators
 *   runExportHtmlAction — calls the HTML export pipeline
 *   runExportInstructorPackAction — calls exportInstructorPack
 *   runDoctorAction — recomputes token breakdown + logs stats
 *   runToggleDisabledAction — writes state.disabled toggle
 *
 * Pattern (ADR-iter6-03): each handler dispatches doing.start at entry,
 * then doing.ok / doing.err + snapshot.refresh on completion.
 * All action handlers are async; the Ink layer invokes them from useEffect.
 *
 * All reads are wrapped in try/catch — any failure produces empty/zero fields
 * rather than throwing, so the shell boots even in a half-broken project.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readManifest } from "../core/manifest.js";
import { readState, writeState } from "../core/state.js";
import { computeTokenBreakdown } from "../core/token-measure.js";
import { buildArtifactsForPreset } from "../core/presets.js";
import { bootstrapClaudeCodeInstallers } from "../connectors/claude-code/artifacts/index.js";
import { runInstall } from "../core/install-engine.js";
import { runUninstall } from "../core/uninstall-engine.js";
import { runAllGenerators } from "../generate/index.js";
import type { ProjectPaths } from "../core/paths.js";
import type { ShellSnapshot, ShellAction } from "./types.js";
import type { TokenBreakdown } from "../core/token-measure.js";

// ---------------------------------------------------------------------------
// Public: buildSnapshot
// ---------------------------------------------------------------------------

const RECENT_EVENTS_LIMIT = 5;
const TOKEN_BUDGET = 500;

/**
 * Build a ShellSnapshot from disk state.
 *
 * @param paths - Null when no project root is resolvable (non-project dir).
 *                When null, returns an "uninstalled" empty snapshot.
 */
export async function buildSnapshot(paths: ProjectPaths | null): Promise<ShellSnapshot> {
  if (paths === null) {
    return emptySnapshot();
  }

  let installed = false;
  let preset: ShellSnapshot["preset"] = undefined;
  let manifestSize = 0;
  let tokenBreakdown: TokenBreakdown = emptyBreakdown();
  let fixedContextTokens = 0;
  let disabled = false;
  let currentPhase: string | undefined;
  let sessionLabel: string | undefined;

  // Read manifest (determines installed state)
  try {
    const manifest = readManifest(paths.manifestPath);
    if (manifest !== null) {
      installed = true;
      preset = manifest.preset as ShellSnapshot["preset"];
      manifestSize = manifest.artifacts.length;

      // Compute token breakdown (sync reads inside computeTokenBreakdown)
      tokenBreakdown = computeTokenBreakdown(manifest, paths.root);
      fixedContextTokens = sumBreakdown(tokenBreakdown);
    }
  } catch {
    // Malformed manifest → treat as not installed
    installed = false;
  }

  // Read state (disabled, phase, session)
  try {
    const state = readState(paths.statePath);
    disabled = state.disabled;
    currentPhase = state.currentPhase;
    sessionLabel = state.sessionLabel;
  } catch {
    // State unreadable → defaults
  }

  // Tail-read recent events
  const recentEvents = readRecentEvents(paths.eventsJsonl, RECENT_EVENTS_LIMIT);

  // Count pending suggestions
  const pendingReview = countLines(path.join(paths.logbookDir, "pending-suggestions.jsonl"));

  // ADR count: scan logbook/decisions/*.md
  const adrCount = countDecisions(paths.root);

  // Lesson count: count events with type === "manual.lesson"
  const lessonCount = countLessons(paths.eventsJsonl);

  const snap: ShellSnapshot = {
    projectRoot: paths.root,
    installed,
    manifestSize,
    tokenBreakdown,
    fixedContextTokens,
    budget: TOKEN_BUDGET,
    recentEvents,
    pendingReview,
    adrCount,
    lessonCount,
  };
  // exactOptionalPropertyTypes: only set optional fields when defined
  if (preset !== undefined) snap.preset = preset;
  if (disabled !== undefined) snap.disabled = disabled;
  if (currentPhase !== undefined) snap.currentPhase = currentPhase;
  if (sessionLabel !== undefined) snap.sessionLabel = sessionLabel;
  return snap;
}

// ---------------------------------------------------------------------------
// ActionContext
// ---------------------------------------------------------------------------

export interface ActionContext {
  paths: ProjectPaths;
  dispatch: (a: ShellAction) => void;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Install LogBook artifacts using the given preset.
 */
export async function runInstallAction(
  ctx: ActionContext,
  opts: { preset: "minimal" | "standard" | "teaching" },
): Promise<void> {
  ctx.dispatch({ type: "doing.start", label: "Installing...", returnTo: "home" });
  try {
    bootstrapClaudeCodeInstallers();
    const artifacts = buildArtifactsForPreset(opts.preset);
    await runInstall({
      paths: ctx.paths,
      preset: opts.preset,
      artifacts,
      dryRun: false,
    });
    ctx.dispatch({ type: "doing.ok", message: `Installed (${opts.preset})` });
    const snap = await buildSnapshot(ctx.paths);
    ctx.dispatch({ type: "snapshot.refresh", snapshot: snap });
  } catch (err) {
    ctx.dispatch({ type: "doing.err", message: errorMessage(err) });
  }
}

/**
 * Uninstall LogBook artifacts (force=true — TUI already confirmed via modal).
 */
export async function runUninstallAction(ctx: ActionContext): Promise<void> {
  ctx.dispatch({ type: "doing.start", label: "Uninstalling...", returnTo: "home" });
  try {
    bootstrapClaudeCodeInstallers();
    await runUninstall({ paths: ctx.paths, dryRun: false });
    ctx.dispatch({ type: "doing.ok", message: "Uninstall complete" });
    const snap = await buildSnapshot(ctx.paths);
    ctx.dispatch({ type: "snapshot.refresh", snapshot: snap });
  } catch (err) {
    ctx.dispatch({ type: "doing.err", message: errorMessage(err) });
  }
}

/**
 * Run all generators (build command equivalent).
 */
export async function runBuildAction(ctx: ActionContext): Promise<void> {
  ctx.dispatch({ type: "doing.start", label: "Building docs...", returnTo: "home" });
  try {
    await runAllGenerators({ paths: ctx.paths });
    ctx.dispatch({ type: "doing.ok", message: "Build complete" });
    const snap = await buildSnapshot(ctx.paths);
    ctx.dispatch({ type: "snapshot.refresh", snapshot: snap });
  } catch (err) {
    ctx.dispatch({ type: "doing.err", message: errorMessage(err) });
  }
}

/**
 * Export HTML report.
 * Uses dynamic import to keep HTML export pipeline out of cold-start path.
 */
export async function runExportHtmlAction(ctx: ActionContext): Promise<void> {
  ctx.dispatch({ type: "doing.start", label: "Exporting HTML...", returnTo: "home" });
  try {
    const { exportHtml } = await import("../export/index.js");
    await exportHtml({ paths: ctx.paths });
    ctx.dispatch({ type: "doing.ok", message: "HTML export complete" });
    const snap = await buildSnapshot(ctx.paths);
    ctx.dispatch({ type: "snapshot.refresh", snapshot: snap });
  } catch (err) {
    ctx.dispatch({ type: "doing.err", message: errorMessage(err) });
  }
}

/**
 * Export instructor pack (HTML bundle with all docs + ADRs + teaching scripts).
 */
export async function runExportInstructorPackAction(
  ctx: ActionContext,
  opts?: { safe?: boolean },
): Promise<void> {
  ctx.dispatch({ type: "doing.start", label: "Exporting instructor pack...", returnTo: "home" });
  try {
    const { exportInstructorPack } = await import("../export/instructor-pack.js");
    await exportInstructorPack({ paths: ctx.paths, safe: opts?.safe ?? false });
    ctx.dispatch({ type: "doing.ok", message: "Instructor pack exported" });
    const snap = await buildSnapshot(ctx.paths);
    ctx.dispatch({ type: "snapshot.refresh", snapshot: snap });
  } catch (err) {
    ctx.dispatch({ type: "doing.err", message: errorMessage(err) });
  }
}

/**
 * Run doctor: recompute token breakdown and report health.
 */
export async function runDoctorAction(ctx: ActionContext): Promise<void> {
  ctx.dispatch({ type: "doing.start", label: "Running doctor...", returnTo: "home" });
  try {
    const manifest = readManifest(ctx.paths.manifestPath);
    if (manifest === null) {
      ctx.dispatch({ type: "doing.ok", message: "Not installed" });
      return;
    }
    const breakdown = computeTokenBreakdown(manifest, ctx.paths.root);
    const total = sumBreakdown(breakdown);
    const pct = Math.round((total / TOKEN_BUDGET) * 100);
    const msg = `${total}/${TOKEN_BUDGET} tokens (${pct}%) — ${manifest.artifacts.length} artifacts`;
    ctx.dispatch({ type: "doing.ok", message: msg });
    const snap = await buildSnapshot(ctx.paths);
    ctx.dispatch({ type: "snapshot.refresh", snapshot: snap });
  } catch (err) {
    ctx.dispatch({ type: "doing.err", message: errorMessage(err) });
  }
}

/**
 * Toggle the disabled flag in state.json.
 *
 * @param currentDisabled - The current disabled state (will be toggled).
 */
export async function runToggleDisabledAction(
  ctx: ActionContext,
  currentDisabled: boolean,
): Promise<void> {
  const label = currentDisabled ? "Enabling hooks..." : "Disabling hooks...";
  ctx.dispatch({ type: "doing.start", label, returnTo: "configure" });
  try {
    const state = readState(ctx.paths.statePath);
    state.disabled = !currentDisabled;
    writeState(ctx.paths.statePath, state);
    const msg = state.disabled ? "Hooks disabled" : "Hooks enabled";
    ctx.dispatch({ type: "doing.ok", message: msg });
    const snap = await buildSnapshot(ctx.paths);
    ctx.dispatch({ type: "snapshot.refresh", snapshot: snap });
  } catch (err) {
    ctx.dispatch({ type: "doing.err", message: errorMessage(err) });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptySnapshot(): ShellSnapshot {
  // exactOptionalPropertyTypes: omit optional fields rather than setting to undefined
  return {
    projectRoot: null,
    installed: false,
    manifestSize: 0,
    tokenBreakdown: emptyBreakdown(),
    fixedContextTokens: 0,
    budget: TOKEN_BUDGET,
    recentEvents: [],
    pendingReview: 0,
    adrCount: 0,
    lessonCount: 0,
  };
}

function emptyBreakdown(): TokenBreakdown {
  return {
    skill: 0,
    augmentClaudemd: 0,
    mcpToolDescriptions: 0,
    slashCommandDescriptions: 0,
    subagentDescriptions: 0,
    statusline: 0,
    sessionStart: 0,
  };
}

function sumBreakdown(b: TokenBreakdown): number {
  return (
    b.skill +
    b.augmentClaudemd +
    b.mcpToolDescriptions +
    b.slashCommandDescriptions +
    b.subagentDescriptions +
    b.statusline +
    b.sessionStart
  );
}

/**
 * Read the last N lines from a JSONL events file.
 * Falls back to [] on any error (file missing, malformed lines, etc.).
 */
function readRecentEvents(
  filePath: string,
  limit: number,
): ShellSnapshot["recentEvents"] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const tail = lines.slice(-limit);
    return tail
      .map((line) => {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          return {
            ts: typeof obj["ts"] === "string" ? obj["ts"] : "",
            type: typeof obj["type"] === "string" ? obj["type"] : "unknown",
            preview: typeof obj["preview"] === "string" ? obj["preview"] : "",
          };
        } catch {
          return null;
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  } catch {
    return [];
  }
}

/**
 * Count non-empty lines in a file. Returns 0 if file does not exist or error.
 */
function countLines(filePath: string): number {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/**
 * Count *.md files in logbook/decisions/ directory.
 */
function countDecisions(projectRoot: string): number {
  try {
    const decisionsDir = path.join(projectRoot, "logbook", "decisions");
    if (!fs.existsSync(decisionsDir)) return 0;
    return fs.readdirSync(decisionsDir).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/**
 * Count events of type "manual.lesson" in events.jsonl.
 */
function countLessons(eventsJsonl: string): number {
  try {
    if (!fs.existsSync(eventsJsonl)) return 0;
    const raw = fs.readFileSync(eventsJsonl, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    let count = 0;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj["type"] === "manual.lesson") count++;
      } catch {
        // Skip malformed lines
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
