/**
 * ArtifactKindName is already defined in src/types/manifest.ts — this module
 * re-exports it from there and adds the installer-registry constants so that
 * the connector layer doesn't need to import from src/types directly.
 */

export type { ArtifactKindName } from "../../../types/manifest.js";

// Iter1-only kinds (the ones we actually install in iteration 1).
export const ITER1_KINDS: ReadonlyArray<import("../../../types/manifest.js").ArtifactKindName> = [
  "hook",
  "gitignore_entry",
];

// Iter2 additions: new installer kinds introduced in iteration 2.
// T4 activates "mcp_server"; T5 will activate "augment_claudemd"; T6 activates "slash_command".
export const ITER2_KINDS: ReadonlyArray<import("../../../types/manifest.js").ArtifactKindName> = [
  "mcp_server",
  "augment_claudemd",
  "slash_command",
];

// Iter3 additions: new installer kinds introduced in iteration 3.
// T2 activates "skill".
export const ITER3_KINDS: ReadonlyArray<import("../../../types/manifest.js").ArtifactKindName> = [
  "skill",
];

// Iter4 additions: new installer kinds introduced in iteration 4.
// T2 activates "subagent"; T3 activates "statusline".
export const ITER4_KINDS: ReadonlyArray<import("../../../types/manifest.js").ArtifactKindName> = [
  "subagent",
  "statusline",
];

// ID prefix per kind — used by concrete installers to generate lb-* ids.
export const ID_PREFIXES: Record<import("../../../types/manifest.js").ArtifactKindName, string> = {
  hook: "lb-hook",
  mcp_server: "lb-mcp",
  slash_command: "lb-cmd",
  skill: "lb-skill",
  subagent: "lb-agent",
  augment_claudemd: "lb-claudemd",
  statusline: "lb-statusline",
  gitignore_entry: "lb-gitignore",
};
