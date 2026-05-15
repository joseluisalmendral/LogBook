export type DecisionStatus = "proposed" | "accepted" | "superseded" | "rejected";

export interface DecisionOption {
  title: string;                  // short label of the option
  description: string;            // 1–3 sentence summary
  tradeoffs?: string;             // pros/cons in prose
}

export interface Decision {
  id: string;                     // ULID
  session_id: string;             // session in which the decision was recorded
  timestamp: string;              // RFC3339 UTC
  title: string;                  // ≤500 chars (§31 size cap)
  status: DecisionStatus;         // lifecycle state
  context: string;                // problem framing (Nygard "Context")
  options: DecisionOption[];      // alternatives considered (Nygard "Options")
  chosen: string;                 // title of the picked option (must match an entry in `options`)
  consequences: string;           // downstream effects (Nygard "Consequences")
  supersedes?: string;            // id of a prior decision this replaces
  tags: string[];                 // free-form labels
  nygard_path?: string;           // optional relative md path when an ADR file was generated
}
