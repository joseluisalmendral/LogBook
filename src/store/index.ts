/**
 * Store façade — re-exports all public store primitives.
 *
 * appendEvent is the high-level helper for persisting a typed Event to JSONL.
 * SQLite indexing (ingest pipeline) is intentionally NOT done here; that belongs
 * in S9's ingest pipeline so S5 stays a pure persistence layer with no
 * event-shape opinions.
 */

export { openIndex, closeIndex, type OpenIndexOptions } from "./sqlite.js";
export { appendJsonl, type AppendEventOptions } from "./jsonl.js";
export { migrate } from "./migrate.js";
export { DDL, SCHEMA_VERSION } from "./schema.js";

import { appendJsonl } from "./jsonl.js";
import type { Event } from "../types/event.js";

/**
 * Serialize an Event to JSON and append it to the given JSONL file.
 * Delegates entirely to appendJsonl — no transformation logic lives here.
 */
export async function appendEvent(
  jsonlPath: string,
  event: Event,
): Promise<void> {
  await appendJsonl(jsonlPath, JSON.stringify(event));
}
