# LogBook documentation

LogBook is a local CLI in Node.js + TypeScript that documents AI-built projects via Claude Code hooks, MCP tools, and pedagogical exports. It captures decisions, errors, and lessons as they happen and renders them into deterministic markdown docs, teaching scripts, and self-contained HTML exports.

This directory is the canonical reference for LogBook v1.1. The repository's root [`README.md`](../README.md) covers installation and a 30-second quick start; everything beyond that lives here.

## Contents

| File | What it covers |
|------|----------------|
| [`01-getting-started.md`](./01-getting-started.md) | Prerequisites, install paths, your first 5 minutes, preset choice, LLM setup, common gotchas. |
| [`02-concepts.md`](./02-concepts.md) | What LogBook is, what it is not, the data flow, artifacts, presets, token budget, byte-identity, redaction. |
| [`03-cli-reference.md`](./03-cli-reference.md) | Every command and subcommand, flags, side effects, exit codes, examples. |
| [`04-flows-by-role.md`](./04-flows-by-role.md) | End-to-end flows for the developer, the instructor, and the student reading an instructor-pack. |
| [`05-architecture.md`](./05-architecture.md) | Directory map, install engine, anchor specs, string-patch contract, MCP server, LLM router, TUI pattern, test pyramid. |
| [`06-construction-log.md`](./06-construction-log.md) | How LogBook itself was built across 6 SDD iterations — methodology, decisions, bugs caught by tests. |
| [`07-troubleshooting.md`](./07-troubleshooting.md) | Top 10 gotchas with symptom → diagnosis → fix. |
| [`08-teaching-preset-walkthrough.md`](./08-teaching-preset-walkthrough.md) | Hands-on storyline for the `teaching` preset — install → daily flow → worked Rust example → end-of-week pack export. |

## Where to start

Pick the entry point that matches your role:

- **I'm new — start here.** → [`01-getting-started.md`](./01-getting-started.md)
- **I want to understand the concepts.** → [`02-concepts.md`](./02-concepts.md)
- **I need a command reference.** → [`03-cli-reference.md`](./03-cli-reference.md)
- **I'm an instructor designing a class.** → [`04-flows-by-role.md`](./04-flows-by-role.md#b-instructor-designing-a-class) — and then [`08-teaching-preset-walkthrough.md`](./08-teaching-preset-walkthrough.md) for the concrete storyline.
- **I'm curious about the architecture.** → [`05-architecture.md`](./05-architecture.md)
- **I want to replicate how this was built.** → [`06-construction-log.md`](./06-construction-log.md)
- **Something is broken.** → [`07-troubleshooting.md`](./07-troubleshooting.md)

## Status

LogBook v1.1 (post-iter6). MVP feature-complete plus the unified TUI shell layer. 1286 tests green (909 unit + 354 integration + 23 e2e). Not yet published to npm — install instructions cover the dev-clone + `pnpm link --global` path.

The canonical specification is [`logbook_mvp_spec_v3.md`](../logbook_mvp_spec_v3.md) at the repo root.
