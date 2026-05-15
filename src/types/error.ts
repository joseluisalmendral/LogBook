export type ErrorSource = "agent" | "tool" | "hook" | "build" | "test" | "manual";

export interface LogError {                 // renamed to avoid colliding with global Error
  id: string;                                // ULID
  session_id: string;                        // session this error belongs to
  timestamp: string;                         // RFC3339 UTC
  kind: string;                              // taxonomic label (e.g. "TypeError","HookTimeout")
  message: string;                           // human-readable message ≤500 chars
  stack?: string;                            // stack trace if available; redacted before persist
  source: ErrorSource;                       // who produced the error
  related_event_id?: string;                 // the Event that triggered it, if known
  resolved: boolean;                         // toggled by a Fix
  fix_id?: string;                           // back-pointer to the Fix that closed this
}

export interface Fix {
  id: string;                                // ULID
  error_id: string;                          // mandatory back-pointer
  timestamp: string;                         // RFC3339 UTC
  description: string;                       // what was changed
  diff_ref?: string;                         // git sha / patch ref / blob hash for forensic linkage
  verified: boolean;                         // did a test or manual check confirm it
  follow_ups: string[];                      // ids of created Lesson/Decision/Resource items
}
