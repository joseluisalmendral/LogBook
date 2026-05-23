/**
 * logbook visual-direction — Log a visual direction decision (B4).
 *
 * PASSIVE (INV-1, B4-S3):
 *   This is an opt-in CLI command. No hooks fire automatically.
 *   Running logbook sessions without this command produces zero visual_direction events.
 *
 * Required flags:
 *   --candidates <comma-separated>  — design approaches considered (B4-R1)
 *   --chosen <string>               — the chosen direction (B4-R1)
 *   --rationale <string>            — reason for choosing (B4-R1)
 *
 * Missing any required flag → non-zero exit + usage on stderr (B4-R5).
 * Candidates CSV is parsed into string[] before persistence (B4-R2).
 * Event validated with VisualDirectionPayloadSchema (INV-7).
 * Redaction applied automatically by appendEvent (INV-8).
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState } from "../../core/state.js";
import { appendEvent } from "../../store/index.js";
import { VisualDirectionPayloadSchema } from "../../events/schemas.js";
import * as v from "valibot";

export default defineCommand({
  meta: {
    name: "visual-direction",
    description: "Log a visual direction decision",
  },
  args: {
    candidates: {
      type: "string",
      required: true,
      description: "Comma-separated list of design approaches considered",
    },
    chosen: {
      type: "string",
      required: true,
      description: "The chosen design direction",
    },
    rationale: {
      type: "string",
      required: true,
      description: "Rationale for the chosen direction",
    },
  },
  async run({ args }) {
    const candidatesRaw = args["candidates"] as string | undefined;
    const chosen = args["chosen"] as string | undefined;
    const rationale = args["rationale"] as string | undefined;

    // B4-R5: all flags required — exit non-zero with usage if any is missing.
    if (!candidatesRaw || !chosen || !rationale) {
      const missing: string[] = [];
      if (!candidatesRaw) missing.push("--candidates");
      if (!chosen) missing.push("--chosen");
      if (!rationale) missing.push("--rationale");
      process.stderr.write(
        `error: missing required flag(s): ${missing.join(", ")}\n\n` +
        `Usage: logbook visual-direction --candidates <csv> --chosen <direction> --rationale <text>\n\n` +
        `Example:\n` +
        `  logbook visual-direction \\\n` +
        `    --candidates "Stitch,Dribble,Awwwards" \\\n` +
        `    --chosen "Stitch" \\\n` +
        `    --rationale "Best mobile-first patterns"\n`,
      );
      process.exit(1);
    }

    // B4-R2: parse candidates from comma-separated string to string[].
    const candidates = candidatesRaw
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    if (candidates.length === 0) {
      process.stderr.write(
        `error: --candidates must contain at least one non-empty entry\n`,
      );
      process.exit(1);
    }

    const payload = {
      entryType: "visual_direction" as const,
      candidates,
      chosen,
      rationale,
    };

    // INV-7: validate with valibot before persistence.
    let validated: v.InferOutput<typeof VisualDirectionPayloadSchema>;
    try {
      validated = v.parse(VisualDirectionPayloadSchema, payload);
    } catch (err) {
      process.stderr.write(
        `error: payload validation failed — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Resolve project paths.
    let root: string;
    try {
      root = resolveProjectRoot();
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
    const paths = makePaths(root);
    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // INV-8: appendEvent applies redaction automatically.
    let eventId: string;
    try {
      const { event } = await appendEvent(paths, {
        kind: "visual_direction",
        sessionId,
        provider: "logbook-cli",
        payload: validated as Record<string, unknown>,
      });
      eventId = event.id;
    } catch (err) {
      process.stderr.write(
        `error: failed to persist event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    process.stdout.write(JSON.stringify({ id: eventId }) + "\n");
    process.exit(0);
  },
});
