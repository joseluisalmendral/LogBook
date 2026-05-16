/**
 * ADR Nygard generator with atomic adrCounter.
 *
 * Three exported surfaces:
 *
 *   slugify(title)         — pure; kebab-case slug, max 50 chars, ASCII-only
 *   renderAdr(n, input)    — pure; Nygard markdown body, deterministic
 *   writeAdrFile(paths, input) — async side-effect; acquires proper-lockfile on
 *                                state.json to guarantee counter monotonicity
 *                                under concurrency
 *
 * Atomicity contract:
 *   Even if N concurrent decision calls fire simultaneously, proper-lockfile
 *   serialises all state.json reads + writes so each call gets a unique,
 *   strictly incrementing counter. No duplicates, though gaps are allowed on
 *   failed writes (lock is released in `finally` even on error).
 */

import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { join } from "pathe";
import { readState, writeState } from "../core/state.js";
import type { ProjectPaths } from "../core/paths.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AdrInput {
  title: string;
  context?: string;
  chosen?: string;
  consequences?: string;
  /** Free-form text describing options that were considered. */
  alternatives?: string;
  /** Decision status — default "Proposed". */
  status?: string;
  /** RFC3339 UTC date string; default is now(). */
  date?: string;
}

export interface AdrResult {
  /** Counter that was assigned (atomically incremented). */
  counter: number;
  /** Kebab-case slug derived from title. */
  slug: string;
  /** File name: "NNNN-<slug>.md" */
  filename: string;
  /** Absolute path under <projectRoot>/logbook/decisions/. */
  filepath: string;
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

/**
 * Convert a title to a URL-safe kebab-case slug.
 *
 * Algorithm:
 *  1. Lowercase
 *  2. Replace any non-ASCII-alphanumeric characters with "-"
 *  3. Collapse multiple consecutive "-" into a single "-"
 *  4. Strip leading and trailing "-"
 *  5. Truncate to 50 chars
 *  6. Strip trailing "-" again in case truncation left one
 *  7. If result is empty, return "untitled"
 */
export function slugify(title: string): string {
  let slug = title
    .toLowerCase()
    // Replace non-ASCII-alphanumeric chars with a dash.
    // [^a-z0-9] covers ASCII; unicode letters/accents fall through as non-matching.
    .replace(/[^a-z0-9]+/g, "-")
    // Collapse consecutive dashes.
    .replace(/-{2,}/g, "-")
    // Strip leading and trailing dashes.
    .replace(/^-+|-+$/g, "");

  // Truncate to 50 chars.
  if (slug.length > 50) {
    slug = slug.slice(0, 50).replace(/-+$/, "");
  }

  return slug || "untitled";
}

// ---------------------------------------------------------------------------
// renderAdr
// ---------------------------------------------------------------------------

const NA = "_n/a_";

/**
 * Render an ADR body in Nygard format.
 *
 * Every section header is always present; missing optional fields render as
 * `_n/a_` so the output is always well-formed Markdown.
 *
 * The function is PURE — it takes an optional `now()` injector for deterministic
 * testing. Pass `opts.now` to fix the date in tests.
 */
export function renderAdr(
  counter: number,
  input: AdrInput,
  opts: { now?: () => string } = {},
): string {
  const now = opts.now ?? (() => new Date().toISOString());
  const date = input.date ?? now();
  const num = String(counter).padStart(4, "0");
  const status = input.status ?? "Proposed";

  const section = (heading: string, body: string | undefined): string =>
    `## ${heading}\n\n${body?.trim() || NA}\n`;

  return [
    `# ${num}. ${input.title}`,
    ``,
    `Date: ${date}`,
    ``,
    section("Status", status),
    section("Context", input.context),
    section("Decision", input.chosen),
    section("Consequences", input.consequences),
    section("Options considered", input.alternatives),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// writeAdrFile (atomic)
// ---------------------------------------------------------------------------

/**
 * Write an ADR file atomically, with a locked state.json increment.
 *
 * Safety details:
 *  - proper-lockfile REQUIRES the target file to exist before lock acquisition.
 *    We ensure state.json exists (creating it with defaultState if missing)
 *    BEFORE calling lockfile.lock().
 *  - The parent directory for state.json is also created if missing.
 *  - The ADR file is written via a tmp-file + rename so readers always see a
 *    complete file or nothing.
 *  - The lock is released in `finally` — it is NEVER left held on error.
 *
 * Concurrency guarantee:
 *  10 simultaneous calls will serialise at the lockfile step and produce
 *  counters 1, 2, …, 10 with no duplicates or gaps.
 */
export async function writeAdrFile(
  paths: ProjectPaths,
  input: AdrInput,
  opts: { now?: () => string } = {},
): Promise<AdrResult> {
  // --- Pre-lock: ensure state.json parent dir and file exist --------------- //
  // proper-lockfile cannot lock a non-existent file.
  const stateDir = dirname(paths.statePath);
  await fs.mkdir(stateDir, { recursive: true });

  // Create state.json if missing. Using "wx" (exclusive create) means if
  // two concurrent calls race here, only one writes — both end up with a
  // valid file afterwards (the other sees EEXIST and skips).
  try {
    const defaultContent =
      JSON.stringify(
        { version: 1, disabled: false, warnings: [], staleLocksReleased: 0 },
        null,
        2,
      ) + "\n";
    await fs.writeFile(paths.statePath, defaultContent, { flag: "wx" });
  } catch (err) {
    // EEXIST = file already exists — that's fine, proceed.
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  // --- Acquire lock on state.json ----------------------------------------- //
  // `stale: 5000` — consider a lock stale after 5 s (guards against crashes
  // that leave lock files behind). `retries: 5` — retry with exponential
  // back-off so concurrent callers serialise cleanly instead of failing fast.
  // Ensures counter monotonicity under concurrency (the core T9 invariant).
  const release = await lockfile.lock(paths.statePath, {
    realpath: false,
    retries: {
      retries: 10,
      factor: 1.5,
      minTimeout: 20,
      maxTimeout: 300,
      randomize: true,
    },
    stale: 5000,
  });

  try {
    // --- Read current counter ----------------------------------------------- //
    const state = readState(paths.statePath);
    const counter = (state.adrCounter ?? 0) + 1;
    state.adrCounter = counter;

    // --- Derive file path --------------------------------------------------- //
    const slug = slugify(input.title);
    const filename = `${String(counter).padStart(4, "0")}-${slug}.md`;
    const filepath = join(paths.dataDir, "decisions", filename);

    // --- Ensure decisions/ directory exists --------------------------------- //
    await fs.mkdir(dirname(filepath), { recursive: true });

    // --- Render and write ADR atomically (tmp + rename) --------------------- //
    const body = renderAdr(counter, input, opts);
    const tmp = filepath + ".tmp";
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, filepath);

    // --- Persist updated adrCounter to state.json --------------------------- //
    // writeState is synchronous (tmpfile+rename) — safe under the lock.
    writeState(paths.statePath, state);

    return { counter, slug, filename, filepath };
  } finally {
    // Always release the lock, even on error — never leave a stale lock.
    await release();
  }
}
