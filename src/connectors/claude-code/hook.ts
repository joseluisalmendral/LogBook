// src/connectors/claude-code/hook.ts
// Full hook entrypoint — reads stdin and runs the ingest pipeline.
// MUST NEVER exit non-zero. The try/catch swallows everything.
import { readAllStdin } from "../../util/stdin.js";
import { ingestClaudePayload } from "./ingest.js";

// Hook total budget is p95 < 200 ms (spec §non-negotiable-constraints).
// Stdin read takes most of the wall clock — Claude Code pipes the
// PostToolUse payload (which can be several KB including the tool_response)
// and the hook only starts processing when stdin closes. Reserve 75% of the
// budget for stdin and 25% for ingest + write. Before 2026-05-21 the stdin
// budget was 100 ms, which silently dropped events on loaded systems or
// large tool responses (regression 2026-05-21 audit, WARNING #9).
const STDIN_TIMEOUT_MS = 150;

async function main(): Promise<number> {
  try {
    const { payload: stdinPayload, timedOut } = await readAllStdin({ timeoutMs: STDIN_TIMEOUT_MS });

    // If stdin timed out and produced no data, there is nothing to ingest.
    if (timedOut && stdinPayload.length === 0) return 0;

    // Empty payload (non-timeout) — also nothing to ingest.
    if (!stdinPayload) return 0;

    await ingestClaudePayload({ stdinPayload, stdinTruncated: timedOut });
    return 0;
  } catch (err) {
    // Hooks MUST NEVER exit non-zero — degrade silently.
    if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
      process.stderr.write(`logbook-hook error: ${(err as Error).message}\n`);
    }
    return 0;
  }
}

main().then((code) => process.exit(code));
