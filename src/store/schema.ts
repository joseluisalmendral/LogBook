/**
 * SQLite v1 DDL for the LogBook index.
 *
 * Design intent: the SQLite index is for FAST LOOKUP only.
 * JSONL files remain the canonical event source.
 * Schema is normalized, but selected payload fields are denormalized
 * into the events table (e.g. payload_text, payload_tool_name) so SQL
 * WHERE clauses can filter without parsing JSONL.
 *
 * tags_json columns store JSON arrays serialized as TEXT (iter1; no JSON1
 * functions used; iter2 may upgrade to JSON1 virtual columns or FTS5).
 */

export const SCHEMA_VERSION = 1;

export const DDL = {
  schema_version: `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,

  events: `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_id TEXT,
    timestamp TEXT NOT NULL,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    kind TEXT NOT NULL,
    phase TEXT,
    redacted INTEGER NOT NULL,
    latency_ms INTEGER,
    payload_text TEXT,
    payload_tool_name TEXT,
    meta_json TEXT
  )`,

  events_session_idx: `CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp)`,

  events_kind_idx: `CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, timestamp)`,

  sessions: `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    project_root TEXT NOT NULL,
    agent TEXT NOT NULL,
    model TEXT,
    phase TEXT,
    event_count INTEGER NOT NULL DEFAULT 0,
    decision_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0
  )`,

  decisions: `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    chosen TEXT NOT NULL,
    supersedes TEXT,
    tags_json TEXT
  )`,

  errors: `CREATE TABLE IF NOT EXISTS errors (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT NOT NULL,
    related_event_id TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    fix_id TEXT
  )`,

  fixes: `CREATE TABLE IF NOT EXISTS fixes (
    id TEXT PRIMARY KEY,
    error_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0
  )`,

  lessons: `CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    timestamp TEXT NOT NULL,
    title TEXT NOT NULL,
    promotable INTEGER NOT NULL DEFAULT 0,
    tags_json TEXT
  )`,

  resources: `CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    uri TEXT NOT NULL,
    title TEXT,
    added_at TEXT NOT NULL,
    tags_json TEXT
  )`,

  milestones: `CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    title TEXT NOT NULL,
    tags_json TEXT
  )`,

  suggestions: `CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  links: `CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relation TEXT NOT NULL
  )`,

  links_idx: `CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_id)`,
} as const;
