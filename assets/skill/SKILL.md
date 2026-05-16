---
name: logbook-auto-capture
description: Capture architectural decisions, didactic errors, fixes, lessons, and milestones via LogBook MCP tools
---

Use LogBook MCP tools to capture durable learning during this session.

When the user makes an architectural decision (technology choice, tradeoff resolved, pattern established), call `logbook_decision` with title, context, chosen, consequences.

When something fails in an instructive way, call `logbook_error` with kind and message. When you fix it, call `logbook_fix` linking to the error id.

When the user articulates a non-obvious insight worth keeping, call `logbook_lesson` with title and body.

When a phase or feature closes, call `logbook_milestone` with title and description.

Skip routine actions. Capture only learning that survives the session.
