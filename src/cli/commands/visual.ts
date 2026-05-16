/**
 * logbook visual <path> [--note <s>] — Reference a visual artifact (image/screenshot).
 *
 * IMPORTANT: iter2 stores a REFERENCE only. No file is copied.
 * The file copy (to logbook/visuals/) is deferred to iter4 alongside
 * the teaching-script subagents feature.
 *
 * Side effects:
 *  1. Validates the path resolves within the project root (path-escape guard).
 *  2. Appends a `manual.visual` event with project-relative path to events.jsonl.
 *  3. Prints JSON: { path, note? }.
 *
 * Design §3 CLI command signatures — visual row.
 * Design §2 — `visual` semantics: "reference only (no copy in iter2)" locked here.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { appendJsonl } from "../../store/jsonl.js";
import { generateUlid } from "../../util/ulid.js";
import { assertWithinProject } from "../../util/path-confine.js";

export default defineCommand({
  meta: {
    name: "visual",
    description: "Reference a visual artifact (image/screenshot)",
  },
  args: {
    path: {
      type: "positional",
      required: true,
      description: "Path to the visual file (relative or absolute)",
    },
    note: {
      type: "string",
      required: false,
      description: "Optional note",
    },
  },
  async run({ args }) {
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
    const rawPath = args["path"] as string;
    const note = args["note"] as string | undefined;

    // Security: assert the path resolves within the project root.
    let resolvedPath: string;
    try {
      resolvedPath = assertWithinProject(rawPath, root);
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Compute project-relative path for storage.
    // NOTE: iter2 stores a reference only — no file is copied.
    const relativePath = nodePath.relative(root, resolvedPath);

    // Ensure evidence directory exists.
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    // Build event — omit undefined fields.
    const event: Record<string, unknown> = {
      id: generateUlid(),
      type: "manual.visual",
      ts: new Date().toISOString(),
      path: relativePath,
      ...(note !== undefined && note !== "" && { note }),
    };

    try {
      await appendJsonl(paths.eventsJsonl, JSON.stringify(event));
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Output.
    const output: Record<string, unknown> = { path: relativePath };
    if (note !== undefined && note !== "") output["note"] = note;

    process.stdout.write(JSON.stringify(output) + "\n");
    process.exit(0);
  },
});
