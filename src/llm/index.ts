export * from "./guards.js";
export { createRouter } from "./provider-router.js";
export { redactBeforeSend } from "./redact-before-send.js";
export { summarizeMilestone, summarizeProject } from "./summarize.js";
export type { SummarizeOptions, SummarizeMilestoneResult } from "./summarize.js";
// Adapters NOT re-exported from barrel — access via createRouter opts.mockAdapter
// or let the router select them based on auth resolution.
