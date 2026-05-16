/**
 * Sliding window rate limiter per tool name.
 *
 * Policy: at most `maxCallsPerWindow` calls per `windowMs` milliseconds,
 * tracked independently for each tool name.
 *
 * Implementation: Map<toolName, number[]> of call timestamps.
 * On each allow() call, timestamps older than windowMs are pruned first,
 * then the window count is checked against the limit.
 *
 * Boundary: a timestamp is pruned when its age is >= windowMs (i.e. the
 * timestamp at exactly `now - windowMs` is evicted, so a new call at that
 * exact moment is allowed). This means the window is half-open: [now-windowMs, now).
 */
export class SlidingWindowLimiter {
  // Per-tool timestamp buckets (millisecond epoch timestamps).
  private readonly _windows = new Map<string, number[]>();

  constructor(
    private readonly maxCallsPerWindow: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Returns true if the call is within the rate limit for `toolName`,
   * recording the call timestamp if allowed. Returns false if the limit
   * is exceeded (call is NOT recorded — rejected calls do not consume quota).
   */
  allow(toolName: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // Retrieve or create the timestamp bucket for this tool.
    let timestamps = this._windows.get(toolName);
    if (timestamps === undefined) {
      timestamps = [];
      this._windows.set(toolName, timestamps);
    }

    // Prune timestamps that are >= windowMs old (age >= windowMs → evicted).
    // Work from the front since we always append (ascending order).
    let pruneCount = 0;
    while (pruneCount < timestamps.length) {
      const ts = timestamps[pruneCount];
      // ts is guaranteed to be a number here (we only push numbers below).
      if (ts !== undefined && ts <= cutoff) {
        pruneCount++;
      } else {
        break;
      }
    }
    if (pruneCount > 0) {
      timestamps.splice(0, pruneCount);
    }

    // Check limit.
    if (timestamps.length >= this.maxCallsPerWindow) {
      return false;
    }

    // Record this call.
    timestamps.push(now);
    return true;
  }
}
