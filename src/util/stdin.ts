import type { Readable } from "node:stream";

export interface ReadStdinOptions {
  /** Stream to read from. Defaults to process.stdin. Overridable for tests. */
  stream?: Readable;
  /** Milliseconds to wait before giving up when no data arrives. Default 100ms. */
  timeoutMs?: number;
  /** Maximum number of bytes to accumulate. Inputs exceeding this are truncated. Default 1MB. */
  maxBytes?: number;
}

/**
 * Read all data from stdin (or a provided Readable) into a UTF-8 string.
 *
 * - Returns "" on timeout (no data within timeoutMs window).
 * - Returns "" on empty stream.
 * - Returns truncated string + emits console.error when maxBytes is exceeded.
 * - Never throws — the hook path must NEVER fail.
 */
export async function readAllStdin(opts?: ReadStdinOptions): Promise<string> {
  const stream: Readable = opts?.stream ?? process.stdin;
  const timeoutMs: number = opts?.timeoutMs ?? 100;
  const maxBytes: number = opts?.maxBytes ?? 1_048_576; // 1MB default

  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;
    let settled = false;

    let timer: ReturnType<typeof setTimeout> | undefined;

    function settle(value: string): void {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      resolve(value);
    }

    function buildResult(): string {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (truncated) {
        // Already sliced during accumulation — return as-is.
        return raw;
      }
      return raw;
    }

    // Set up timeout: if no 'end' fires within the window, resolve with what we have.
    timer = setTimeout(() => {
      timer = undefined;
      settle(buildResult());
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
        truncated = true;
        console.error(
          `logbook-stdin: input truncated to ${maxBytes} bytes — input exceeded maxBytes cap`,
        );
        // Stop listening; settle immediately with what we have.
        settle(buildResult());
        return;
      }

      chunks.push(buf);
      totalBytes += buf.length;
    });

    stream.on("end", () => {
      settle(buildResult());
    });

    stream.on("error", () => {
      // Errors must not propagate — hook must never fail.
      settle(buildResult());
    });
  });
}
