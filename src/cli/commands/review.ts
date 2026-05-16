/**
 * logbook review
 *
 * Spawns an Ink-based TUI for reviewing pending suggestions and unclassified
 * events. When the user exits (q = abandon, c = commit decisions), the CLI
 * persists the review decisions and prints a summary.
 *
 * When no items are found, prints "Nothing to review." and exits 0.
 *
 * TTY detection: if stdin is not a TTY (e.g., pipe or test environment),
 * the Ink TUI is not spawned — the command returns with a non-interactive
 * message. Use ink-testing-library for integration tests.
 *
 * Exit codes:
 *   0 → success (including "nothing to review" and normal TUI exit)
 *   1 → unexpected error
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { loadReviewItems } from "../../review/flows.js";
import { persistReviewDecisions } from "../../review/persist.js";

export default defineCommand({
  meta: {
    name: "review",
    description: "Review pending suggestions and unclassified events in a TUI",
  },
  args: {},
  async run() {
    // 1. Resolve project root + paths
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

    // 2. Load items (pending suggestions + unclassified events)
    const pendingSuggestionsPath = `${paths.logbookDir}/pending-suggestions.jsonl`;
    const eventsJsonlPath = paths.eventsJsonl;

    let items: Awaited<ReturnType<typeof loadReviewItems>>;
    try {
      items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    } catch (err) {
      process.stderr.write(
        `error: failed to load review items — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // 3. No items → exit 0 early
    if (items.length === 0) {
      process.stdout.write("Nothing to review.\n");
      process.exit(0);
    }

    // 4. TTY check — avoid hanging in non-interactive environments
    if (!process.stdin.isTTY) {
      process.stdout.write(
        `Found ${items.length} item(s) to review, but stdin is not a TTY. ` +
        `Run this command in an interactive terminal.\n`,
      );
      process.exit(0);
    }

    // 5. Spawn the TUI
    let finalState: Awaited<ReturnType<typeof import("../../review/tui.js").runReviewTUI>>;
    try {
      const { runReviewTUI } = await import("../../review/tui.js");
      finalState = await runReviewTUI({ items });
    } catch (err) {
      process.stderr.write(
        `error: TUI failed — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // 6. Persist decisions (only if not just "exit" with no decisions)
    let counts = { promoted: 0, discarded: 0, skipped: 0 };
    if (Object.keys(finalState.decisions).length > 0) {
      try {
        counts = await persistReviewDecisions({ paths, state: finalState });
      } catch (err) {
        process.stderr.write(
          `error: failed to persist decisions — ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    }

    // 7. Print summary
    process.stdout.write(
      `Review complete: ${counts.promoted} promoted, ${counts.discarded} discarded, ${counts.skipped} skipped\n`,
    );

    process.exit(0);
  },
});
