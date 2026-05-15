export interface Session {
  id: string;                     // ULID
  started_at: string;             // RFC3339 UTC
  ended_at?: string;              // RFC3339 UTC; absent while active
  project_root: string;           // absolute path of the project at start
  agent: string;                  // "claude-code" | "cursor" | … (iter1: always "claude-code")
  model?: string;                 // primary model used in the session if known
  phase?: string;                 // domain phase label
  milestone_ids: string[];        // milestones touched in this session
  event_count: number;            // cached count for quick status; reconstructible from JSONL
  decision_count: number;         // cached count of decisions logged in session
  error_count: number;            // cached count of errors logged in session
}
