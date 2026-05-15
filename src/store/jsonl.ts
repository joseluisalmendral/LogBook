import { mkdir, open, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

export interface AppendEventOptions {
  /** Call fdatasync after write for durability. Default: true. */
  fsyncOnAppend?: boolean;
  /** Milliseconds after which proper-lockfile considers a held lock stale. Default: 5000. */
  staleMs?: number;
}

/**
 * Atomically append a single JSON line to a JSONL file.
 *
 * Algorithm:
 *  1. Ensure parent directory exists.
 *  2. Create the file (empty) if it doesn't exist — required by proper-lockfile.
 *  3. Acquire proper-lockfile with stale-lock recovery and exponential back-off.
 *  4. Open file in append mode, write line + "\n", fdatasync if requested, close fd.
 *  5. Release lock in finally — NEVER leaves the lock held on error.
 *
 * On any throw, logs to stderr and rethrows. Callers on the hook path wrap in
 * try/catch and degrade gracefully (never exit non-zero).
 */
export async function appendJsonl(
  filePath: string,
  line: string,
  opts: AppendEventOptions = {},
): Promise<void> {
  const { fsyncOnAppend = true, staleMs = 5_000 } = opts;

  // 1. Ensure parent directory exists.
  const parentDir = dirname(filePath);
  await mkdir(parentDir, { recursive: true });

  // 2. Create the file if missing — proper-lockfile requires the file to exist
  //    before lock acquisition. Use appendFile with flag 'a' which is a no-op
  //    if the file already exists (POSIX O_CREAT|O_APPEND is atomic per-file).
  await appendFile(filePath, "");

  // 3. Acquire lock with stale recovery + retries.
  //    Under high concurrency (e.g. 100 simultaneous appenders), we need enough
  //    retries with sufficient back-off to serialize all waiters without timing out.
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, {
      stale: staleMs,
      realpath: false,
      retries: {
        retries: 20,
        factor: 1.2,
        minTimeout: 50,
        maxTimeout: 500,
        randomize: true,
      },
    });

    // 4. Append line atomically under the lock.
    const fd = await open(filePath, "a");
    try {
      await fd.write(line + "\n");
      if (fsyncOnAppend) {
        await fd.datasync();
      }
    } finally {
      await fd.close();
    }
  } catch (err) {
    process.stderr.write(
      `[logbook] appendJsonl failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    throw err;
  } finally {
    // 5. Always release the lock, even on error.
    if (release) {
      await release();
    }
  }
}
