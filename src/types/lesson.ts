export interface Lesson {
  id: string;                                // ULID
  session_id?: string;                       // optional — lessons can be project-wide
  timestamp: string;                         // RFC3339 UTC
  title: string;                             // ≤500 chars
  body: string;                              // markdown body (§31 payload ≤8KB)
  tags: string[];                            // searchable labels
  related_events: string[];                  // Event ids that triggered the lesson
  promotable: boolean;                       // candidate for promotion into CLAUDE.md / Skill
}

export interface Resource {
  id: string;                                // ULID
  kind: "url" | "file" | "snippet" | "doc";  // resource type
  uri: string;                               // url, repo-relative path, or content-addressable ref
  title?: string;                            // display title
  added_at: string;                          // RFC3339 UTC
  tags: string[];
}

export interface Milestone {
  id: string;                                // ULID
  timestamp: string;                         // RFC3339 UTC
  title: string;                             // ≤500 chars
  description: string;                       // ≤8KB markdown
  session_ids: string[];                     // sessions contributing to milestone
  decision_ids: string[];                    // decisions contributing to milestone
  tags: string[];
}

export type SuggestionKind =
  | "promote_lesson"
  | "create_decision"
  | "link_resource"
  | "flag_error";

export interface Suggestion {
  id: string;                                // ULID
  source: "agent" | "hook" | "doctor";       // who proposed it
  kind: SuggestionKind;                      // what action is suggested
  payload: Record<string, unknown>;          // kind-specific arguments
  status: "pending" | "accepted" | "dismissed";
  created_at: string;                        // RFC3339 UTC
}
