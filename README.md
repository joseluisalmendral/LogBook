# LogBook

A local CLI that documents AI-built projects via Claude Code hooks, MCP tools, and pedagogical exports.

LogBook captures decisions, errors, fixes, lessons, and resources as they happen — automatically through Claude Code hooks and MCP tool calls, or manually via CLI commands. It renders them into deterministic markdown, Nygard ADRs, LLM-backed teaching scripts, and self-contained HTML you can hand to a class.

## Status

**MVP complete + TUI shell v1.1.** Six SDD iterations shipped. 1286 tests green (909 unit + 354 integration + 23 e2e). Not yet published to npm — install via local clone + `pnpm link --global`. See [`docs/01-getting-started.md`](./docs/01-getting-started.md) for full instructions.

## Install

```sh
git clone https://github.com/joseluisalmendral/LogBook.git
cd LogBook
pnpm install && pnpm build
pnpm link --global
```

Full installation paths (including ad-hoc per-project usage and the future `pnpm add -g logbook`) live in [`docs/01-getting-started.md`](./docs/01-getting-started.md).

## 30-second quick start

```sh
cd /path/to/your-project
logbook init --preset standard --yes      # install (or just `logbook` for the TUI wizard)
# work normally in Claude Code — auto-capture is on
logbook build                              # regenerate logbook/docs/*
logbook export instructor-pack             # produce a single shareable HTML
```

Three presets: `minimal` (hooks only, 0 fixed tokens), `standard` (default, 381 tokens), `teaching` (full pedagogical stack, 499 tokens).

To remove cleanly: `logbook uninstall --force`. To remove everything including data: `logbook purge --force`.

## Documentation

Everything lives under [`docs/`](./docs/README.md):

- [`docs/01-getting-started.md`](./docs/01-getting-started.md) — install, your first 5 minutes, preset choice, LLM setup, gotchas
- [`docs/02-concepts.md`](./docs/02-concepts.md) — the conceptual model
- [`docs/03-cli-reference.md`](./docs/03-cli-reference.md) — every command with flags and examples
- [`docs/04-flows-by-role.md`](./docs/04-flows-by-role.md) — flows for developers, instructors, and students
- [`docs/05-architecture.md`](./docs/05-architecture.md) — internals for maintainers
- [`docs/06-construction-log.md`](./docs/06-construction-log.md) — how LogBook itself was built (6 SDD iterations, methodology, bug case studies)
- [`docs/07-troubleshooting.md`](./docs/07-troubleshooting.md) — top 10 gotchas with fixes

Canonical product spec: [`logbook_mvp_spec_v3.md`](./logbook_mvp_spec_v3.md).

## Architecture in 5 bullets

- **Local-first.** All data lives in the project. No server. No upload except explicit LLM calls.
- **JSONL is the source of truth.** `logbook/evidence/events.jsonl` is canonical; SQLite is a best-effort index, reconstructable from the JSONL.
- **Byte-identical install/uninstall.** Every shared file (`CLAUDE.md`, `.claude/settings.local.json`, `.claude/mcp.json`, `.gitignore`) is edited via pure string-patching — never `JSON.parse` + `JSON.stringify`. Uninstall restores the original bytes exactly. Enforced by 6 e2e gate tests.
- **500-token ceiling for fixed agent context.** `logbook doctor --measure` enforces it; teaching preset sits at 499/500. CI blocks any change that pushes it over.
- **Deterministic generation.** `logbook build` reads JSONL and writes markdown inside idempotent `<!-- logbook:generated -->` blocks. Content outside markers is preserved literally.

## License

ISC
