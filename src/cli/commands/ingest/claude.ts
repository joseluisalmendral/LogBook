import { defineCommand } from "citty";
import { readAllStdin } from "../../../util/stdin.js";
import { ingestClaudePayload } from "../../../connectors/claude-code/ingest.js";

export default defineCommand({
  meta: {
    name: "claude",
    description: "Read a Claude Code hook payload from stdin and append to JSONL",
  },
  args: {
    "session-id": {
      type: "string",
      required: false,
      description: "Override session id (default: env LOGBOOK_SESSION_ID or generated ULID)",
    },
  },
  async run({ args }) {
    // CLI tolerates a longer wait than the hook bundle (which must exit fast).
    const stdinPayload = await readAllStdin({ timeoutMs: 5_000 });
    const opts: { stdinPayload: string; sessionId?: string } = { stdinPayload };
    if (args["session-id"]) opts.sessionId = String(args["session-id"]);
    try {
      await ingestClaudePayload(opts);
    } catch (err) {
      if (process.env["LOGBOOK_DEBUG"] === "1") {
        process.stderr.write(`ingest error: ${(err as Error).message}\n`);
      }
    }
    process.exit(0); // exit clean even on parse error per design
  },
});
