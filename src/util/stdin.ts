import type { Readable } from "node:stream";

export interface ReadStdinOptions {
  /** Stream to read from. Defaults to process.stdin. Overridable for tests. */
  stream?: Readable;
  /** Milliseconds to wait before giving up when no data arrives. Default 100ms. */
  timeoutMs?: number;
  /** Maximum number of bytes to accumulate. Inputs exceeding this are truncated. Default 1MB. */
  maxBytes?: number;
}

export interface ReadStdinResult {
  /** The collected stdin payload (may be partial when timedOut or maxBytes exceeded). */
  payload: string;
  /** True when the timeout fired before stdin reached EOF. */
  timedOut: boolean;
}

/**
 * Read all data from stdin (or a provided Readable) into a UTF-8 string.
 *
 * - Returns `{ payload: "", timedOut: false }` on empty stream.
 * - Returns `{ payload: "", timedOut: true }` on timeout with no data.
 * - Returns `{ payload: partial, timedOut: true }` on timeout with partial data.
 * - Returns `{ payload: truncated, timedOut: false }` on maxBytes exceeded (different failure mode).
 * - Never throws — the hook path must NEVER fail.
 */
export async function readAllStdin(opts?: ReadStdinOptions): Promise<ReadStdinResult> {
  const stream: Readable = opts?.stream ?? process.stdin;
  const timeoutMs: number = opts?.timeoutMs ?? 100;
  const maxBytes: number = opts?.maxBytes ?? 1_048_576; // 1MB default

  return new Promise<ReadStdinResult>((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    let didTimeout = false;

    let timer: ReturnType<typeof setTimeout> | undefined;

    function settle(result: ReadStdinResult): void {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      resolve(result);
    }

    function buildResult(): string {
      return Buffer.concat(chunks).toString("utf-8");
    }

    // Set up timeout: if no 'end' fires within the window, resolve with what we have.
    timer = setTimeout(() => {
      timer = undefined;
      didTimeout = true;
      settle({ payload: buildResult(), timedOut: true });
    }, timeoutMs);

    stream.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, "utf-8");

      if (totalBytes + buf.length > maxBytes) {
        // Truncate to maxBytes total.
        const remaining = maxBytes - totalBytes;
        if (remaining > 0) {
          chunks.push(buf.subarray(0, remaining));
          totalBytes = maxBytes;
        }
        console.error(
          `logbook-stdin: input truncated to ${maxBytes} bytes — input exceeded maxBytes cap`,
        );
        // maxBytes truncation is NOT a timeout — different failure mode.
        settle({ payload: buildResult(), timedOut: false });
        return;
      }

      chunks.push(buf);
      totalBytes += buf.length;
    });

    stream.on("end", () => {
      settle({ payload: buildResult(), timedOut: didTimeout });
    });

    stream.on("error", () => {
      // Errors must not propagate — hook must never fail.
      settle({ payload: buildResult(), timedOut: didTimeout });
    });
  });
}
