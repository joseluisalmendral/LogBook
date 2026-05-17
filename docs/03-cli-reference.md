# 03 — CLI reference

Every command, every subcommand, every flag. Ordered by user-flow: setup → capture → curation → generation → export → diagnostic.

Conventions:

- Required flags are marked `(required)`.
- All commands that mutate disk accept `--dry-run` or `--json` where useful; see each entry.
- Exit code `0` means success, `1` means error (with a message on `stderr`).
- All JSONL writes use file locking (`proper-lockfile`) and `fdatasync` before return.

---

## Zero-arg invocation

```sh
logbook
```

**What it does.** When called with no arguments AND both `stdin` and `stdout` are TTYs, opens the unified TUI shell (`src/tui/shell.ts`). Non-interactive invocations (CI, pipes) fall through to citty's help.

**Screens.** Home (dashboard), install wizard (3 steps), configure (toggle disabled / phase / preset / providers), review bridge (mounts the iter3 review TUI), doing (in-flight action overlay).

**Keys.**

| Key | Action |
|-----|--------|
| `j` / `k`, arrow down/up | Navigate menu |
| Enter | Select |
| `b` / Esc | Back |
| `q` | Quit (from home) / back (from subscreens) |
| Ctrl+C | Force quit |
| `n` / Tab | Wizard: next step |
| `p` | Wizard: previous step |

**Side effects.** None until you select an action. Each action delegates to a CLI command under the hood (`init`, `build`, `export`, `doctor`, `uninstall`, `disable`/`enable`).

---

## Setup commands

### `logbook init`

```sh
logbook init [--preset minimal|standard|teaching|full] [--yes] [--dry-run]
```

**Description.** Install LogBook artifacts into the current project.

**Args.**

| Flag | Type | Default | Notes |
|------|------|---------|-------|
| `--preset` | string | `minimal` | `minimal` (2 artifacts) · `standard` (14) · `teaching` (18) · `full` (alias for `teaching`). |
| `--yes` | bool | `false` | Skip the interactive confirmation prompt. |
| `--dry-run` | bool | `false` | Plan only; print the table of what would be installed. No writes. |

**Side effects.**

- Writes `.logbook/install-manifest.json`.
- Creates backups in `.logbook/backups/` for every shared file it edits.
- Appends entries to `.claude/settings.local.json`, `.claude/mcp.json`, `.gitignore`, and (for `standard`/`teaching`) `CLAUDE.md`.
- Creates owned files under `.claude/commands/`, `.claude/skills/`, `.claude/subagents/`.

**Exit codes.** `0` on success, `1` on detection error / rollback.

**Examples.**

```sh
logbook init --preset standard --yes
logbook init --preset teaching --dry-run
```

**When to use.** Once per project, at the start. Subsequent runs are idempotent (entries already present are skipped) but if you change preset you should `uninstall` first.

### `logbook status`

```sh
logbook status [--json]
```

**Description.** Show installed artifacts and recent activity.

**Output.** A table of `id | kind | file | installed_at` plus a kv block `disabled | warnings | preset`. With `--json`, returns `{ manifest, state }`.

**Exit codes.** `0` always (prints `LogBook not installed.` if no manifest).

### `logbook doctor`

```sh
logbook doctor [--measure] [--json]
```

**Description.** Diagnose install health and measure context cost.

**Args.**

| Flag | Type | Notes |
|------|------|-------|
| `--measure` | bool | Compute the fixed-context token breakdown. |
| `--json` | bool | Emit JSON instead of the human-readable table. |

**Verifies.** Each artifact in the manifest is checked via its installer's `verify()` method (file presence, content hash match, anchor still locatable).

**Token breakdown fields (with `--measure`).**

```
fixedContextTokens      — sum
skill                   — chars(SKILL.md) / 4  (reference.md = 0)
augmentClaudemd         — chars(block body) / 4
mcpToolDescriptions     — sum of description chars / 4 across 9 tools
slashCommandDescriptions— sum of YAML description chars / 4 across 8 commands
subagentDescriptions    — 0 (Claude Code surfaces these separately)
statusline              — 0 (UI element)
sessionStart            — 120 (conservative max per design §6)
```

**Exit codes.** `0` on success.

**When to use.** Whenever something doesn't behave as expected. Also the CI gate for the 500-token budget.

### `logbook disable`

```sh
logbook disable
```

**Description.** Soft-disable LogBook hooks without removing artifacts. Sets `state.disabled = true` in `.logbook/state.json`. The hot path in the hook checks this flag and exits immediately.

**Side effects.** Writes `.logbook/state.json`.

**When to use.** You want to pause LogBook for a session without doing a full uninstall.

### `logbook enable`

```sh
logbook enable
```

**Description.** Re-enable LogBook hooks. Sets `state.disabled = false`.

### `logbook uninstall`

```sh
logbook uninstall [--force] [--dry-run]
```

**Description.** Remove all LogBook artifacts. Data under `logbook/` and `.logbook/` is preserved (use `purge` for full deletion).

**Args.**

| Flag | Type | Notes |
|------|------|-------|
| `--force` | bool | Required unless `--dry-run` is used. |
| `--dry-run` | bool | Plan only; print the table of what would be removed. |

**Side effects.** Replays the manifest in reverse, restoring each shared file to its backed-up bytes. Deletes owned files. Removes sentinel backups (files that did not exist pre-install). Deletes the manifest when fully drained.

**Exit codes.** `0` on success, `1` if `--force` missing in non-dry-run mode.

**Example.**

```sh
logbook uninstall --dry-run         # preview
logbook uninstall --force           # apply
```

### `logbook purge`

```sh
logbook purge --force
```

**Description.** `uninstall` + delete `.logbook/` and `logbook/` entirely. Destructive — no recovery.

**Args.** `--force` is required.

**When to use.** You're done with the project, or you want to start from a clean slate.

---

## Capture commands (ingestion)

These are called by hooks or scripts. Humans rarely run them by hand.

### `logbook ingest claude`

```sh
logbook ingest claude [--session-id <id>]
```

**Description.** Read a Claude Code hook payload from `stdin` and append normalized events to `events.jsonl`.

**Side effects.** Appends one event line. On parse failure, the raw payload is preserved as a degraded `error` event (data-preservation contract). Exits `0` even on malformed input — never blocks Claude Code.

**Hook contract.** p95 < 200 ms; never exits non-zero; degrades silently with a warning in `state.json`.

### `logbook ingest codex`

```sh
logbook ingest codex [--session-id <id>]
```

**Description.** Same shape as `ingest claude` but normalizes Codex payloads via `src/connectors/codex/normalize.ts`. Accepts single-JSON or JSONL on stdin. Malformed lines are written as degraded `error` events so failures are auditable.

**Side effects.** Append-only writes to `events.jsonl` with redaction applied first.

### `logbook ingest otel`

```sh
logbook ingest otel <file>
```

**Description.** Parse an OTLP-JSON file (single envelope or JSONL) and append normalized events. Path is confined to the project root; out-of-tree paths exit `1`.

**Output.** `{ ingested, redacted }` JSON.

---

## Session and phase commands

### `logbook start`

```sh
logbook start [--label "<name>"]
```

**Description.** Open a new LogBook session. Generates a ULID; writes `state.session`; appends `manual.session_start` to `events.jsonl`.

**Output.** `{ sessionId, label? }`.

### `logbook phase <name>`

```sh
logbook phase architecture
```

**Description.** Set the active phase. Phases per spec §11: `discovery, requirements, architecture, planning, implementation, validation, debugging, deployment, retrospective`.

**Side effects.** Appends `manual.phase` event; writes `state.currentPhase`.

**Output.** `{ phase }`.

### `logbook session rename <new-label>`

```sh
logbook session rename "Initial design"
```

**Description.** Rename the current session label.

**Guards.** Requires an active session — exits `1` otherwise.

**Side effects.** Appends `manual.session_rename` event; writes `state.sessionLabel`.

**Output.** `{ old, new }`.

### `logbook snapshot`

```sh
logbook snapshot [--note "<text>"]
```

**Description.** Capture a manual snapshot event. Best-effort grabs git HEAD sha + dirty file count (via `execFileSync` — no shell exec). Always exits `0` even if git is absent.

**Output.** `{ sha, dirty, note? }`.

---

## Manual marker commands

These mirror the MCP tools — the human entry point for the same domain.

### `logbook decision`

```sh
logbook decision --title "<t>" --chosen "<c>" \
                 [--status "Proposed"] [--context "<x>"] \
                 [--options "a,b,c"] [--consequences "<...>"] \
                 [--supersedes <ulid>] [--tags "<a,b>"]
```

**Description.** Record an architectural decision. Writes an ADR file under `logbook/decisions/NNNN-<slug>.md` using the Nygard format. The `adrCounter` in `state.json` is incremented atomically via `proper-lockfile`.

**Side effects.** Writes ADR markdown, appends `manual.decision` event, inserts a SQLite index row (best-effort).

**Output.** `{ id, counter, adrPath }`.

### `logbook error`

```sh
logbook error --kind <taxonomy> --message "<msg>" [--stack "<trace>"] [--source agent|tool|hook|build|test|manual]
```

**Description.** Record an error. `--stack` is redacted before persisting (stack traces frequently contain secrets — spec §31).

**Output.** `{ id }`.

### `logbook fix`

```sh
logbook fix --error-id <ulid> --description "<text>" [--verified]
```

**Description.** Link a fix to an error. With `--verified`, also `UPDATE errors SET resolved=1, fix_id=<id>` in SQLite.

**Output.** `{ id, errorId }`.

### `logbook lesson`

```sh
logbook lesson --title "<t>" --body "<...>" [--tags "<a,b>"] [--promotable]
```

**Description.** Record a lesson learned. Lessons are authored by humans only — the Skill instructs the agent to use `logbook_suggest("lesson", ...)` instead.

**Output.** `{ id }`.

### `logbook resource`

```sh
logbook resource --kind url|file|snippet|doc --uri <uri> [--title "<t>"] [--tags "<a,b>"]
```

**Description.** Attach a resource. For `--kind file`, the path is confined to the project root.

**Output.** `{ id }`.

### `logbook visual <path>`

```sh
logbook visual ./screenshots/dashboard.png [--note "<text>"]
```

**Description.** Reference a visual artifact. **Iter2 stores a reference only — no file copy.** The path-confine guard rejects paths outside the project root.

**Output.** `{ path, note? }`.

### `logbook milestone`

```sh
logbook milestone --title "<t>" --description "<d>" \
                  [--session-ids "<a,b>"] [--decision-ids "<a,b>"] [--tags "<a,b>"]
```

**Description.** Record a milestone — typically the closure of a phase. Used by `summarize milestone` and `teaching-script` to scope content.

**Output.** `{ id }`.

---

## Curation commands

### `logbook review`

```sh
logbook review
```

**Description.** Launch the Ink-based TUI to curate pending suggestions (`pending-suggestions.jsonl`) and unclassified events.

**Guards.** If `stdin` is not a TTY, prints a count and exits without spawning the TUI.

**Output on exit.** `Review complete: N promoted, N discarded, N skipped`.

**Side effects on commit (`c`).** Persists decisions: promoted suggestions become canonical events; discarded suggestions are removed.

**Keys.** Vim-style navigation. Press `?` inside for the keymap.

### `logbook promote <event-id> --teaching <value> [--json]`

```sh
logbook promote 01HXYZ... --teaching high
```

**Description.** Tag a stored event with a `teachingValue ∈ {high, medium, low}`.

**Guards.** Validates the value enum (exits `1` on invalid). Scans `events.jsonl` to confirm the event id exists (exits `1` if not found).

**Side effects.** Appends a `manual.promote` event (canonical audit trail). SQLite UPDATE is a no-op in iter3 — the JSONL is the source of truth; a `teaching_value` column may be added later.

**Output.** `{ id, eventId, teachingValue }`.

---

## Generation commands

### `logbook build`

```sh
logbook build [--out <dir>] [--json]
```

**Description.** Run all 3 deterministic generators against `events.jsonl`. Writes:

- `logbook/docs/index.md`
- `logbook/docs/timeline.md`
- `logbook/docs/errors-and-lessons.md`

**Args.**

| Flag | Notes |
|------|-------|
| `--out` | Override the output directory (default: `logbook/docs`). |
| `--json` | Emit the build report as JSON. |

**Side effects.** Idempotent. Content outside `<!-- logbook:generated -->` markers is preserved literally. SQLite is not used by `build` — JSONL is the only source.

**Output.** Lists each generated file with byte count + SHA-256 prefix, plus duration.

### `logbook summarize milestone [id|last]`

```sh
logbook summarize milestone last [--out <path>] [--json]
```

**Description.** LLM-backed summary of a milestone's events. Default target is the last milestone recorded.

**Args.**

| Flag | Notes |
|------|-------|
| `[id]` | Milestone ULID or `last` (default). Positional. |
| `--out` | Override output path (default: `logbook/evidence/summaries/<id>.md`). |
| `--json` | Emit `{ ok, summaryPath, bytes }` or `{ ok:false, error }`. |

**Side effects.** Writes a markdown file. Uses the LLM router (`src/llm/provider-router.ts`) which respects `tasks > phase > default` resolution from `.logbook/providers.json`.

**Mock mode.** Setting `LOGBOOK_LLM_MOCK=1` injects a deterministic stub. Used in CI so tests never hit live APIs.

**Exit codes.** `0` on `ok:true`, `1` on `ok:false` (message to stderr).

### `logbook summarize project`

```sh
logbook summarize project [--out <path>] [--json]
```

**Description.** LLM-backed summary of the full project arc. Same router rules and `--json` shape as `summarize milestone`. Default output: `logbook/evidence/summaries/project.md`.

### `logbook teaching-script [id|last]`

```sh
logbook teaching-script last [--out <dir>] [--json]
```

**Description.** Generate an instructor-facing teaching script for a milestone. LLM-backed. Default target is the last milestone.

**Side effects.** Writes to `logbook/teaching-scripts/`. Mock-mode via `LOGBOOK_LLM_MOCK=1` produces a deterministic template.

**Output.** `{ ok, filePath, bytes }` or `{ ok:false, error }`.

### `logbook export html`

```sh
logbook export html [--out <path>] [--safe] [--json]
```

**Description.** Convert the 3 generated docs into a single self-contained HTML file. Inlined CSS; zero external references (asserted by `src/export/sanitize-links.ts`).

**Args.**

| Flag | Notes |
|------|-------|
| `--out` | Default: `logbook/exports/index.html`. |
| `--safe` | Redact absolute paths, usernames, and emails before rendering. Produces `safe-report.md` with the substitution log. |
| `--json` | Emit `ExportReport` as JSON. |

**Implementation note.** The heavy unified/remark/rehype chain is loaded lazily via a non-literal `require()` path so it does not inflate the cold-start CLI bundle (iter3 MONITOR-2 closure). See `src/cli/commands/export/html.ts:31-38`.

### `logbook export instructor-pack`

```sh
logbook export instructor-pack [--out <path>] [--safe] [--json]
```

**Description.** Bundle docs + ADRs + teaching scripts into a single self-contained HTML for instructor distribution. Same `--safe` semantics as `export html`. Default output: `logbook/exports/instructor-pack.html`.

**Contains.** Table of contents, cross-document links rewritten, generated TOC anchors, no external references.

**Known limitation.** Anchor navigation (`#section`) is non-functional pending a post-MVP `rehype-slug` integration. Documented in [`06-construction-log.md`](./06-construction-log.md) as iter5 warning W2.

---

## Provider commands

### `logbook providers list`

```sh
logbook providers list [--json]
```

**Description.** List configured LLM providers from `.logbook/providers.json`.

**Output (table).**

```
default_provider: <alias>

providers:
  <alias>: <kind>/<model>

by_task:
  <task>: <alias>

by_phase:
  <phase>: <alias>
```

### `logbook providers set <target> <provider> [--model <m>]`

```sh
logbook providers set task:teaching-script anthropic-claude-sdk --model claude-opus-4-6
logbook providers set phase:debugging openai-codex
```

**Description.** Set a routing rule. `<target>` is `task:<name>` or `phase:<name>`. If the provider alias doesn't yet exist in `providers.json`, a placeholder entry is auto-created (kind `anthropic`, env `ANTHROPIC_API_KEY`).

**Side effects.** Atomic write via temp-file + rename. A backup of `providers.json` is taken in `.logbook/backups/` (idempotent — sentinel if file absent).

**Output.** `{ key, provider, model? }`.

### `logbook providers test`

```sh
logbook providers test [--provider <alias>] [--task <name>] [--json]
```

**Description.** Send a `ping` to the configured provider and validate the round-trip. Default task name is `providers.test`.

**`--task <name>`** selects the routing entry by task name (uses `by_task` resolution from `providers.json`). Useful for verifying that a specific task routes to the intended provider:

```sh
logbook providers test --task teaching-script --json
logbook providers test --task summarize --json
```

Omitting `--task` is equivalent to `--task providers.test`, which falls through to `default_provider`. This is the backward-compatible default.

**Mock mode.** `LOGBOOK_LLM_MOCK=1` returns `pong` deterministically — used in CI to assert zero real LLM calls.

**Output (success).** `ok: true | provider | model | latencyMs | text`.
**Output (failure).** `ok: false | error | provider | model` with exit code `1`.

---

## Statusline internals

### `logbook state --inline`

```sh
logbook state --inline
```

**Description.** Statusline output mode. Reads `.logbook/state.json` synchronously and prints a single line: `<phase> | <session> | <pending>`. Falls back to `— | — | 0` if state is absent or malformed.

**Performance.** Must complete in ≤ 200 ms. No SQLite, no network.

**When to use.** Invoked by the Claude Code statusline command (`statusLine` key in `.claude/settings.local.json`) when the teaching preset is installed. Not typically run by humans.

```sh
logbook state             # full JSON dump of .logbook/state.json
```

---

## Exit code conventions

| Code | Meaning |
|------|---------|
| `0` | Success, OR informational (e.g. `LogBook not installed.`), OR best-effort hot path (hooks always exit `0`). |
| `1` | Validation error, missing required input, I/O failure, LLM failure, path escape, install/uninstall rollback. |

For automation: every command that does substantial work supports `--json` for structured output. Stream-parsing JSONL outputs is safe — every line is one complete JSON object.

---

Next: [`04-flows-by-role.md`](./04-flows-by-role.md) for end-to-end flows by user role, or [`05-architecture.md`](./05-architecture.md) for internals.
