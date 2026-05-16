# LogBook MCP Tool Reference

On-demand field reference for all 9 LogBook MCP tools. This file is NOT in fixed context — load only when you need field details.

---

## logbook_decision

Record an architectural decision or technology choice.

| Field | Required | Description |
|-------|----------|-------------|
| title | yes | Short name for the decision |
| context | yes | Why this decision was needed |
| chosen | yes | What was decided |
| consequences | yes | Expected effects and tradeoffs |
| tags | no | Array of label strings |

Example: `{ title: "Use SQLite", context: "Need embedded storage", chosen: "better-sqlite3", consequences: "Fast sync reads; no network; single-process only" }`

---

## logbook_error

Record a bug, failure, or instructive mistake.

| Field | Required | Description |
|-------|----------|-------------|
| kind | yes | Category: `bug`, `config`, `environment`, `logic`, `type` |
| message | yes | What went wrong |
| context | no | Surrounding circumstances |

Example: `{ kind: "type", message: "exactOptionalPropertyTypes: undefined not assignable" }`

---

## logbook_fix

Record the resolution of a previously logged error.

| Field | Required | Description |
|-------|----------|-------------|
| errorId | yes | ULID of the linked logbook_error event |
| description | yes | What fixed it |
| diff | no | Key code change summary |

Example: `{ errorId: "01HZ...", description: "Added undefined check before optional access" }`

---

## logbook_lesson

Capture a non-obvious insight worth retaining.

| Field | Required | Description |
|-------|----------|-------------|
| title | yes | Short label |
| body | yes | The insight in 1-3 sentences |
| tags | no | Array of label strings |

Example: `{ title: "vitest moduleResolution bundler", body: "With bundler resolution .js extensions are optional in test imports." }`

---

## logbook_resource

Link an external reference used in the session.

| Field | Required | Description |
|-------|----------|-------------|
| title | yes | Human-readable name |
| url | yes | Full URL |
| note | no | Why this resource was useful |

Example: `{ title: "MCP SDK Server API", url: "https://modelcontextprotocol.io/...", note: "Used setRequestHandler pattern" }`

---

## logbook_milestone

Mark the completion of a phase or feature.

| Field | Required | Description |
|-------|----------|-------------|
| title | yes | Name of the milestone |
| description | yes | What was accomplished |
| tags | no | Array of label strings |

Example: `{ title: "Iter2 Gate", description: "All 15 slices green; byte-identity E2E passing" }`

---

## logbook_phase

Record a shift in working context or focus area.

| Field | Required | Description |
|-------|----------|-------------|
| name | yes | Phase label (e.g. "planning", "implementation", "review") |
| note | no | What changed or why |

Example: `{ name: "implementation", note: "Starting T1 skill body assets" }`

---

## logbook_suggest

Propose a follow-up action or idea for later review.

| Field | Required | Description |
|-------|----------|-------------|
| title | yes | Short description of the suggestion |
| body | yes | Details and rationale |
| priority | no | `high`, `medium`, or `low` |

Example: `{ title: "Add summarize auto-trigger", body: "Run summarize on milestone close automatically in iter4", priority: "low" }`

---

## logbook_state

Read-only tool. Returns current session state — no input fields required.

Returns: `{ sessionId, phase, eventCount, milestoneCount, lastEventAt }`

Call this when you need current session context without appending a new event.
