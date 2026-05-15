import type { EventKind } from "./event.js";

// Envelope for MCP tool input/output — designed now, server wired in iter2.
export interface McpToolEnvelope<I, O> {
  name: string;                              // logbook_* tool name
  input: I;                                  // validated valibot schema input
  output: O;                                 // structured response
}

export interface McpQueryFilter {
  kinds?: EventKind[];                       // restrict by event kind
  session_id?: string;
  since?: string;                            // RFC3339 lower bound
  until?: string;                            // RFC3339 upper bound
  tags?: string[];
  limit?: number;                            // ≤ 200 (rate cap)
}
