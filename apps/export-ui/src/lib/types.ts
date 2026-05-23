/*
 * types.ts — local copy of the ExportPayloadV2 shape consumed by the UI.
 *
 * Why a local copy and not a direct import from `../../../src/generate/build-export-payload.ts`?
 *   The Node-side builder imports from `../core/paths.js` and other Node-only
 *   modules. Pulling that import graph into Vite's TS resolution drags Node
 *   types into a browser bundle. Apply-progress P2 documented that the UI
 *   should re-export the types here.
 *
 * Contract: these definitions MUST stay in sync with
 *   src/generate/build-export-payload.ts → ExportPayloadV2
 * A divergence is a contract bug. P2 build-export-payload tests assert the
 * Node-side shape; this file is the browser-side mirror.
 *
 * Anything optional in payload (e.g. agent-question payload.notes, chapter
 * endTs) stays optional here so the UI handles partial fixtures gracefully.
 */

export interface RenderEvent {
  id: string;
  type: string;
  ts: string;
  title?: string;
  description?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SessionSummary {
  id: string;
  label: string;
  ts: string;
  endTs?: string;
  goal?: string;
  outcome?: string;
}

export interface CourseTotals {
  sessions: number;
  decisions: number;
  errors: number;
  fixes: number;
  lessons: number;
  milestones: number;
  resources: number;
  visuals: number;
  visualDirections: number;
  skillInvocations: number;
  ghAgentRuns: number;
  qaFindings: number;
  agentQuestions: number;
  commits: number;
}

export interface PhaseRef {
  id: string;
  label: string;
  ts: string;
  startEventId?: string;
  endEventId?: string;
}

export interface Chapter {
  sessionId: string;
  label: string;
  ts: string;
  endTs?: string;
  goal?: string;
  outcome?: string;
  phases: PhaseRef[];
  events: RenderEvent[];
}

/**
 * Slice-12 P4 (ADR-SC-D2): role + kind for sanitized raw transcript events.
 * MUST stay in sync with `src/export/transcript-sanitize.ts`.
 */
export type SanitizedRole = "user" | "assistant" | "system" | "tool";
export type SanitizedKind =
  | "message"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "meta";

export interface SanitizedTranscriptEvent {
  id: string;
  timestamp: number;
  role: SanitizedRole;
  type: SanitizedKind;
  name?: string;
  content: string;
  truncated: boolean;
  droppedFields?: string[];
}

export interface SanitizedTranscript {
  sessionId: string;
  events: SanitizedTranscriptEvent[];
  /** Byte position at which the session was capped (null when not hit). */
  truncatedAtBytes: number | null;
  droppedEvents: number;
  originalEventCount: number;
  sanitizedEventCount: number;
}

export interface ExportPayloadV2 {
  version: 2;
  exportedAt: string;
  project: { name: string; root: string; sha: string };
  course: { sessions: SessionSummary[]; totals: CourseTotals };
  chapters: Chapter[];
  decisions: RenderEvent[];
  errors: RenderEvent[];
  fixes: RenderEvent[];
  lessons: RenderEvent[];
  milestones: RenderEvent[];
  resources: RenderEvent[];
  visuals: RenderEvent[];
  visualDirections: RenderEvent[];
  skillInvocations: RenderEvent[];
  ghAgentRuns: RenderEvent[];
  qaFindings: RenderEvent[];
  agentQuestions: RenderEvent[];
  commits: RenderEvent[];
  bodies: Record<string, string>;
  mermaid: Record<string, string>;
  /**
   * Slice-12 P4: sanitized raw transcripts keyed by sessionId. `null` means
   * the JSONL file wasn't accessible on the build machine. The whole field is
   * optional so older payloads stay loadable.
   */
  transcripts?: Record<string, SanitizedTranscript | null>;
}

/**
 * Empty payload used when #lb-data is missing or empty. Lets the UI render an
 * `<EmptyState>` instead of crashing in dev mode or in a never-exported HTML.
 */
export function emptyPayload(): ExportPayloadV2 {
  return {
    version: 2,
    exportedAt: new Date(0).toISOString(),
    project: { name: "", root: "", sha: "" },
    course: {
      sessions: [],
      totals: {
        sessions: 0,
        decisions: 0,
        errors: 0,
        fixes: 0,
        lessons: 0,
        milestones: 0,
        resources: 0,
        visuals: 0,
        visualDirections: 0,
        skillInvocations: 0,
        ghAgentRuns: 0,
        qaFindings: 0,
        agentQuestions: 0,
        commits: 0,
      },
    },
    chapters: [],
    decisions: [],
    errors: [],
    fixes: [],
    lessons: [],
    milestones: [],
    resources: [],
    visuals: [],
    visualDirections: [],
    skillInvocations: [],
    ghAgentRuns: [],
    qaFindings: [],
    agentQuestions: [],
    commits: [],
    bodies: {},
    mermaid: {},
  };
}
