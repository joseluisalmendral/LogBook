# LogBook

LogBook is a local CLI in Node.js + TypeScript that documents AI-built projects via Claude Code hooks,
MCP tools, and pedagogical exports. It captures decisions, errors, and lessons as they happen and
renders them into deterministic markdown docs, teaching scripts, and self-contained HTML exports.

## What it does

- Records decisions, errors, fixes, lessons, resources, and milestones via MCP tools and CLI commands
  — automatically via Claude Code hooks or manually on demand.
- Generates deterministic markdown documentation (ADRs, timeline, error log) inside idempotent
  `<!-- logbook:generated -->` blocks; content you write outside markers is never touched.
- Produces LLM-backed teaching scripts that turn session history into structured learning material.
- Exports self-contained HTML files (no external network calls, no CDN dependencies) and an
  instructor-pack bundle that merges all docs, ADRs, and teaching scripts into a single distributable.
- Installs and uninstalls as a coexistence-friendly Claude Code plugin: append-only edits to shared
  files, every entry tagged, byte-identical uninstall guaranteed.

## Install

```sh
# Global install (once published to npm)
pnpm add -g logbook

# Local dev
pnpm install && pnpm build
```

## Quick start

1. `logbook init --preset minimal` — install hooks, MCP server, and Skill into the current repo.
   Use `--preset standard` for SQLite index + statusline, or `--preset teaching` for the full
   pedagogical stack (subagents, sessionStart memory, teaching-script support).
2. Start working — Claude Code hooks capture events automatically on each tool call.
3. Run `logbook decision`, `logbook error`, `logbook lesson`, etc. to record items manually.
4. Run `logbook build` to regenerate all markdown docs from the JSONL source.
5. Run `logbook export html` or `logbook export instructor-pack` to produce a self-contained HTML file.
6. Run `logbook uninstall --force` to remove all installed artifacts (your data in `logbook/` is preserved).

## Command reference

| Command | Description |
|---------|-------------|
| `logbook init [--preset minimal\|standard\|teaching]` | Install LogBook into the current repo |
| `logbook status` | Show install state, event counts, and last-build timestamp |
| `logbook doctor [--measure]` | Run health checks; `--measure` prints fixed-context token cost |
| `logbook disable` | Disable hooks without uninstalling |
| `logbook enable` | Re-enable previously disabled hooks |
| `logbook uninstall [--force] [--dry-run]` | Remove installed artifacts; data preserved |
| `logbook purge [--force] [--dry-run]` | Remove installed artifacts AND all data |
| `logbook ingest claude` | Ingest a Claude Code session JSON file into the JSONL log |
| `logbook ingest codex` | Ingest a Codex session (stdin JSON) into the JSONL log |
| `logbook ingest otel` | Ingest an OTLP-JSON telemetry file into the JSONL log |
| `logbook decision` | Record an architectural decision (ADR) |
| `logbook error` | Record an error event |
| `logbook fix` | Record a fix for a previously recorded error |
| `logbook lesson` | Record a lesson learned |
| `logbook resource` | Record an external resource (URL, doc, tool) |
| `logbook visual` | Record a visual artifact (screenshot, diagram) |
| `logbook milestone` | Record a project milestone |
| `logbook start` | Start a new session |
| `logbook phase` | Record a phase transition within the current session |
| `logbook session rename` | Rename the current session |
| `logbook snapshot` | Take a snapshot of the current state |
| `logbook summarize milestone` | Generate an LLM-backed summary for a milestone |
| `logbook summarize project` | Generate an LLM-backed project summary |
| `logbook promote` | Promote a draft decision to accepted |
| `logbook review` | Review pending decisions and lessons |
| `logbook providers list` | List configured LLM providers |
| `logbook providers set` | Set active LLM provider and model |
| `logbook providers test` | Test provider connectivity |
| `logbook teaching-script` | Generate a teaching script from session history |
| `logbook build` | Regenerate all markdown docs from JSONL source |
| `logbook export html [--safe]` | Export self-contained HTML; `--safe` redacts paths and emails |
| `logbook export instructor-pack [--safe] [--out <path>]` | Export bundled HTML with all docs, ADRs, and teaching scripts |

## Token budget

LogBook keeps combined fixed-context tokens across all installed artifacts at or below 500 tokens.
This covers the Skill body, CLAUDE.md augment block, MCP tool descriptions, and SessionStart memory.
Verify at any time with `logbook doctor --measure`.

Current preset measurements (teaching preset is the maximum):

| Preset | Fixed-context tokens |
|--------|---------------------|
| minimal | 0 |
| standard | 381 |
| teaching | 499 |

The teaching preset stays 1 token below the hard limit. If future changes push it over 500,
`doctor --measure` will report a budget violation.

## Architecture

- **MCP server** (stdio transport, project-scoped): exposes `logbook_record`, `logbook_query`, and
  `logbook_status` tools to Claude Code. No shell exec, no outbound network, path-confined to project root.
- **Claude Code hooks**: a post-tool hook appends raw events to a JSONL file (p95 < 200 ms, never
  exits non-zero, degrades silently).
- **JSONL canonical source**: all events live in `logbook/events.jsonl`. SQLite is a best-effort
  index rebuilt on demand — never the source of truth.
- **Deterministic generators**: `logbook build` reads JSONL and writes markdown inside idempotent
  `<!-- logbook:generated start/end -->` blocks. Idempotent: running build twice produces the same output.
- **LLM summarization** (optional): `summarize`, `teaching-script`, and `session rename` call a
  configured provider. All other commands work offline.
- **Byte-identical install/uninstall**: every artifact is registered in `.logbook/install-manifest.json`.
  Uninstall replays the manifest in reverse, restoring each shared file to its pre-install state byte-for-byte.

## Uninstall

```sh
logbook uninstall --force
```

Removes all installed artifacts (hooks, MCP registration, Skill, CLAUDE.md block, statusline entry,
subagents). Data in `logbook/` (JSONL, SQLite, exports, docs) is preserved.

To remove everything including data:

```sh
logbook purge --force
```

Both commands accept `--dry-run` to preview changes without writing anything.

## Status

MVP complete (iter1-iter5). 1100+ tests green (755 unit, 333 integration, 23 e2e).
See `logbook_mvp_spec_v3.md` for the canonical specification.

## License

ISC
