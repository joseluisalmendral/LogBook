# LogBook

A local CLI that documents AI-built projects via Claude Code hooks, MCP tools, and pedagogical exports.

LogBook captures decisions, errors, fixes, lessons, and resources as they happen — automatically through Claude Code hooks and MCP tool calls, or manually via CLI commands. It renders them into deterministic markdown, Nygard ADRs, LLM-backed teaching scripts, and self-contained HTML you can hand to a class.

## Status

**v1.1.0** — 1501 tests green (1076 unit + 400 integration + 25 e2e). Multi-provider LLM, Mermaid diagrams, PDF export, annotations, speaker notes. Not yet published to npm — install via local clone + `pnpm link --global`. See [`docs/01-getting-started.md`](./docs/01-getting-started.md) for full instructions.

## Install

```sh
git clone https://github.com/joseluisalmendral/LogBook.git
cd LogBook
pnpm install && pnpm build
pnpm link --global
```

Full installation paths (including ad-hoc per-project usage and the future `pnpm add -g logbook`) live in [`docs/01-getting-started.md`](./docs/01-getting-started.md).

## Quick start

```sh
cd /path/to/your-project
logbook init --preset standard --yes      # install (or just `logbook` for the TUI wizard)
# work normally in Claude Code — auto-capture is on
logbook build                              # regenerate logbook/docs/*
logbook export instructor-pack             # produce a single shareable HTML
```

Three presets: `minimal` (hooks only, 0 fixed tokens), `standard` (default, 381 tokens), `teaching` (full pedagogical stack, 499 tokens).

### LLM providers

| Provider | Kind | Auth |
|----------|------|------|
| Anthropic (Claude) | `anthropic` | `ANTHROPIC_API_KEY` or Claude Code session |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Azure OpenAI | `azure` | `OPENAI_API_KEY` + `base_url` |
| Google Gemini | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Ollama (local) | `local` | None — requires `ollama serve` on `:11434` |
| Codex CLI | `codex-cli` | Configured in the `codex` binary |

Configure a provider:

```sh
logbook providers set task:teaching-script gemini-default --model gemini-2.0-flash
logbook providers test --task teaching-script --json
```

### PDF export

`logbook export pdf` requires Chrome or Chromium:

```sh
# macOS
brew install --cask google-chrome
# Linux
apt install chromium-browser
# Then:
logbook export pdf [--out <path>] [--safe] [--theme <path.css>]
```

Set `CHROME_PATH` env var to point to a non-default Chrome binary.

### Annotations and speaker notes

```sh
# Annotate any captured event:
logbook annotate <event-id> --note "This decision was pivotal because..."

# Export HTML with speaker notes rendered:
logbook export html --speaker-mode
logbook export instructor-pack --speaker-mode
```

Speaker note blocks use the `<!-- logbook:speaker start --> ... <!-- logbook:speaker end -->` marker family.

## Command reference

Full reference with all flags and examples: [`docs/03-cli-reference.md`](./docs/03-cli-reference.md).

Quick reference:

| Command | What it does |
|---------|--------------|
| `logbook init [--preset minimal\|standard\|teaching]` | Install LogBook artifacts into the project |
| `logbook build [--safe]` | Regenerate `logbook/docs/*` from events |
| `logbook decision --title "..." --chosen "..."` | Record an architectural decision (ADR) |
| `logbook decision --with-diff` | Record ADR + capture git SHA + diff stats |
| `logbook annotate <event-id> --note "..."` | Add a note to any captured event |
| `logbook export html [--safe] [--theme <css>] [--speaker-mode]` | Self-contained HTML |
| `logbook export instructor-pack [--safe] [--speaker-mode]` | Full instructor bundle |
| `logbook export pdf [--out <path>] [--safe] [--theme <css>]` | PDF via Chrome/Chromium |
| `logbook providers list` | List configured LLM providers |
| `logbook providers set <target> <provider>` | Configure routing |
| `logbook providers test [--task <name>]` | Validate provider round-trip |
| `logbook summarize milestone [--out <path>]` | LLM summary of a milestone |
| `logbook review` | TUI for curating pending suggestions |
| `logbook doctor [--measure]` | Diagnose install health; measure token budget |
| `logbook uninstall [--force]` | Remove all artifacts (data preserved) |

## Token budget

LogBook enforces a hard ceiling of **500 fixed-context tokens** for all installed artifacts. The teaching preset sits at 499/500. CI blocks any change that exceeds 500.

```sh
logbook doctor --measure --json
```

Fields in the breakdown: `skill`, `augmentClaudemd`, `mcpToolDescriptions`, `slashCommandDescriptions`, `sessionStart`. All sum to `fixedContextTokens`. See [`docs/02-concepts.md`](./docs/02-concepts.md#token-budget) for the full model.

## Documentation

Everything lives under [`docs/`](./docs/):

- [`docs/01-getting-started.md`](./docs/01-getting-started.md) — install, your first 5 minutes, preset choice, LLM setup, gotchas
- [`docs/02-concepts.md`](./docs/02-concepts.md) — the conceptual model
- [`docs/03-cli-reference.md`](./docs/03-cli-reference.md) — every command with flags and examples
- [`docs/04-flows-by-role.md`](./docs/04-flows-by-role.md) — flows for developers, instructors, and students
- [`docs/05-architecture.md`](./docs/05-architecture.md) — internals for maintainers
- [`docs/06-construction-log.md`](./docs/06-construction-log.md) — how LogBook itself was built (7 SDD iterations, methodology, bug case studies)
- [`docs/07-troubleshooting.md`](./docs/07-troubleshooting.md) — top gotchas with fixes
- [`CHANGELOG.md`](./CHANGELOG.md) — version history

Canonical product spec: [`logbook_mvp_spec_v3.md`](./logbook_mvp_spec_v3.md).

## Architecture in 5 bullets

- **Local-first.** All data lives in the project. No server. No upload except explicit LLM calls.
- **JSONL is the source of truth.** `logbook/evidence/events.jsonl` is canonical; SQLite is a best-effort index, reconstructable from the JSONL.
- **Byte-identical install/uninstall.** Every shared file (`CLAUDE.md`, `.claude/settings.local.json`, `.claude/mcp.json`, `.gitignore`) is edited via pure string-patching — never `JSON.parse` + `JSON.stringify`. Uninstall restores the original bytes exactly. Enforced by 8 e2e gate tests.
- **500-token ceiling for fixed agent context.** `logbook doctor --measure` enforces it; teaching preset sits at 499/500. CI blocks any change that pushes it over.
- **Deterministic generation.** `logbook build` reads JSONL and writes markdown inside idempotent `<!-- logbook:generated -->` blocks. Content outside markers is preserved literally.

## Uninstall

```sh
logbook uninstall --force         # removes artifacts; data stays in logbook/ and .logbook/
logbook purge --force             # full deletion (logbook/ + .logbook/)
```

`uninstall` restores every shared file to its pre-install bytes — byte-identically. Other plugins in `.claude/` are unaffected.

## License

ISC
