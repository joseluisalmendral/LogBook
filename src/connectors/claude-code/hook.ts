// src/connectors/claude-code/hook.ts
// Full hook entrypoint — reads stdin and runs the ingest pipeline.
// MUST NEVER exit non-zero. The try/catch swallows everything.
import { readAllStdin } from "../../util/stdin.js";
import { ingestClaudePayload } from "./ingest.js";

async function main(): Promise<number> {
  try {
    const stdinPayload = await readAllStdin({ timeoutMs: 100 });
    if (!stdinPayload) return 0;
    await ingestClaudePayload({ stdinPayload });
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
