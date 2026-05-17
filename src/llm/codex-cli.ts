/**
 * Codex CLI subprocess adapter.
 *
 * Spawns `codex exec --non-interactive --json`, pipes the combined prompt
 * via stdin, buffers stdout, and parses the JSON response.
 *
 * Contract (D3 from proposal §3):
 *   stdin  = systemPrompt + "\n\n" + userPrompt  (then close)
 *   stdout = JSON object; extract .message.content or .output; fallback = raw trim
 *   non-zero exit → throw with exit code + stderr
 *   ENOENT → throw with install hint
 *   timeout (30s default) → SIGTERM, then SIGKILL after 1s grace
 *
 * Mock seam:
 *   LOGBOOK_CODEX_MOCK=1 → returns "[mock codex response]" without subprocess.
 *   assertNotInTestMode() is skipped when mock env is active (mock IS the test path).
 *
 * IMPORTANT: assertNotInTestMode() is called at the top when not mocked.
 * Any test that reaches this code without LOGBOOK_CODEX_MOCK=1 will throw immediately.
 */

import { spawn } from "node:child_process";
import { assertNotInTestMode } from "./guards.js";
import type { LlmAdapterCallInput } from "../types/llm.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 1_000;
const CODEX_INSTALL_HINT =
  "Codex CLI not found. Install it from: https://github.com/openai/codex";

// ---------------------------------------------------------------------------
// Exported helpers (exposed for unit testing)
// ---------------------------------------------------------------------------

/**
 * Parse codex CLI stdout into a plain string.
 *
 * Priority:
 *   1. JSON { message: { content: "..." } }
 *   2. JSON { output: "..." }
 *   3. Raw trimmed string (fallback)
 */
export function parseCodexOutput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;

    // Priority 1: .message.content
    const msg = parsed["message"];
    if (
      msg !== null &&
      msg !== undefined &&
      typeof msg === "object" &&
      !Array.isArray(msg)
    ) {
      const content = (msg as Record<string, unknown>)["content"];
      if (typeof content === "string") return content;
    }

    // Priority 2: .output
    const output = parsed["output"];
    if (typeof output === "string") return output;

    // No known field — return the trimmed raw string (plain text fallback)
    return trimmed;
  } catch {
    // JSON parse failed — treat as plain text
    return trimmed;
  }
}

/**
 * Build an Error from a Codex CLI failure.
 *
 * Accepts:
 *   - exitCode: number → "codex CLI exited with code N: <stderr>"
 *   - "ENOENT"        → install hint
 *   - "timeout"       → timed out message
 */
export function buildCodexError(
  reason: number | "ENOENT" | "timeout",
  stderr: string
): Error {
  if (reason === "ENOENT") {
    return new Error(CODEX_INSTALL_HINT);
  }
  if (reason === "timeout") {
    return new Error("codex CLI timed out after 30s");
  }
  const detail = stderr.trim() !== "" ? `: ${stderr.trim()}` : "";
  return new Error(`codex CLI exited with code ${reason}${detail}`);
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Main Codex CLI adapter.
 *
 * Matches the shape of vercelSdkAdapter and claudeSdkAdapter.
 * The router calls this when providerEntry.kind === "codex-cli".
 */
export async function codexCliAdapter(
  input: LlmAdapterCallInput
): Promise<string> {
  // Mock seam — return immediately without assertNotInTestMode
  if (process.env["LOGBOOK_CODEX_MOCK"] === "1") {
    return "[mock codex response]";
  }

  // Guard: never run real subprocess in test env
  assertNotInTestMode("codex-cli");

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stdinPayload = `${input.systemPrompt}\n\n${input.userPrompt}`;

  return new Promise<string>((resolve, reject) => {
    let proc: ReturnType<typeof spawn>;

    try {
      proc = spawn("codex", ["exec", "--non-interactive", "--json"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      // Synchronous spawn failure (rare but possible on some platforms)
      const spawnErr = err as NodeJS.ErrnoException;
      if (spawnErr.code === "ENOENT") {
        return reject(buildCodexError("ENOENT", ""));
      }
      return reject(err);
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    // ---- Timeout wiring ----
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      // SIGTERM first
      proc.kill("SIGTERM");
      // SIGKILL after grace period
      killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
      }, KILL_GRACE_MS);
      reject(buildCodexError("timeout", ""));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timeoutHandle);
      if (killTimer !== null) clearTimeout(killTimer);
    }

    // ---- stdout ----
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf-8");
    });

    // ---- stderr ----
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf-8");
    });

    // ---- error (ENOENT, permission denied, etc.) ----
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err.code === "ENOENT") {
        reject(buildCodexError("ENOENT", ""));
      } else {
        reject(err);
      }
    });

    // ---- close ----
    proc.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();

      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        reject(buildCodexError(exitCode, stderrBuf));
        return;
      }

      resolve(parseCodexOutput(stdoutBuf));
    });

    // ---- Write prompt to stdin and close it ----
    proc.stdin?.write(stdinPayload, "utf-8");
    proc.stdin?.end();
  });
}
