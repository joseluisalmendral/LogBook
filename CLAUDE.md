# LogBook (repository instructions)

> Iter1-iter5 complete. See README.md for user-facing reference; logbook_mvp_spec_v3.md remains the
> canonical spec for all implementation decisions.

Canonical specification: **`logbook_mvp_spec_v3.md`** at the repo root. Read it fully before writing any code.

## Workflow

1. Before coding any iteration, define explicitly:
   - File structure
   - TypeScript data models (event, session, decision, error, manifest, providers, artifact)
   - CLI commands and MCP tool signatures
   - Per-artifact install/uninstall strategy
   - Coexistence and discovery strategy
   - Markdown generation strategy with idempotent block markers
   - Test plan
2. Implement iterations in order (1 → 5 per §35). Do not advance until the previous iteration's tests are green.
3. The byte-identical install/uninstall e2e test (§24.8, §37) is the gate to leave Iteration 1.

## Non-negotiable constraints

- **Package manager: pnpm.** Lockfile `pnpm-lock.yaml`. Use `pnpm add`, `pnpm add -D`, `pnpm exec`. Do not introduce `package-lock.json` or `yarn.lock`.
- **Token budget:** combined fixed context across all installed agent artifacts ≤ 500 tokens (Skill + CLAUDE.md augment block + MCP tool descriptions + SessionStart memory). Verifiable with `logbook doctor --measure`. See §23.
- **Coexistence:** append-only edits to shared files (`.claude/settings.local.json`, `CLAUDE.md`, `.claude/mcp.json`, `.gitignore`). Every entry tagged with `lb-*` id. Backup before every write. `--dry-run` on every destructive command. See §24.
- **Reversibility:** `logbook uninstall` must leave the repo byte-identical to its pre-install state, even when other plugins are present. Tested in CI.
- **MCP security (§31):** stdio transport only, project-scoped registration, no shell exec from tools, valibot validation on every input, path confinement to project root, file locking on JSONL appends, no outbound network from the server.
- **Hooks:** p95 < 200 ms, never exit non-zero, degrade silently with a warning in `state.json`.
- **Markdown generation:** only inside `<!-- logbook:generated start --> ... <!-- logbook:generated end -->` blocks. Content outside markers is preserved literally.
- **No secrets in JSONL:** Gitleaks-derived regex rules + entropy detection applied before persisting any `tool_response`, `stdout`, or `stderr`.

## Stack

Node 22 LTS + TypeScript strict + citty + valibot + better-sqlite3 + JSONL + unified/remark/rehype + Ink + Vercel AI SDK + `@anthropic-ai/claude-agent-sdk` + `@modelcontextprotocol/sdk` + vitest.

## Style

- Code comments, MCP tool descriptions, Skill bodies, slash commands, and any string loaded into the agent's context: **English** (token efficiency, see §23.2).
- Conversation with the user: **Spanish** (mirror the user's language).
- No emojis unless the user asks.
- Imperative voice. No filler like "you are an expert".
- Avoid duplication: each fact lives in exactly one artifact.

## Definition of "done" for any task

- Tests written and green
- `pnpm doctor --measure` (once implemented) passes within budget
- Manifest updated for any new artifact installed
- `--dry-run` works on every destructive command
- If a shared file was touched, a backup exists in `.logbook/backups/`
