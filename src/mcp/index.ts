/**
 * MCP subsystem barrel.
 *
 * Exports the stable public API of src/mcp/ for use by tests and
 * future internal consumers. The server.ts entry point is not re-exported
 * here because it is a standalone process entry, not a library module.
 */

export { SlidingWindowLimiter } from "./rate-limit.js";
export { writeAuditEvent, type AuditEvent, type WriteAuditEventOptions } from "./audit.js";
export { bootstrapMcpContext, closeMcpContext, type MCPContext, type BootstrapOptions } from "./context.js";
export { ALL_TOOLS, type ToolDef, type JsonSchemaObject } from "./tools/index.js";
