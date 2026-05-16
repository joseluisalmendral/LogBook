# 01 — Getting started

This guide walks a first-time user from a clean machine to a working LogBook install with their first build of generated docs. Allow about 15 minutes the first time; the steady-state cycle is a few seconds.

## Prerequisites

| Requirement | Why |
|-------------|-----|
| Node.js 22 LTS | Runtime target; no other major versions are tested. |
| pnpm 10.28.0 or later | LogBook is pnpm-only. Lockfile is `pnpm-lock.yaml`. Do not introduce `package-lock.json` or `yarn.lock`. |
| Claude Code CLI (optional) | LogBook's automatic capture is driven by Claude Code hooks and MCP. Without it, only the manual CLI commands work. |
| `ANTHROPIC_API_KEY` env var (optional) | Required only if you want `logbook summarize` / `logbook teaching-script` and you don't have an active Claude Code subscription session. |

Check your versions:

```sh
node --version    # v22.x
pnpm --version    # 10.x
```

## Installation paths — choose one

LogBook is not yet published to npm. Pick the path that matches your context.

### 1. Local dev clone + global link (recommended while v1.x is pre-npm)

This is the current canonical path. The `pnpm link --global` step makes the `logbook` binary available system-wide, so hooks installed in any project can invoke it.

```sh
git clone https://github.com/joseluisalmendral/LogBook.git
cd LogBook
pnpm install
pnpm build
pnpm link --global
```

After the link, `which logbook` should resolve to your pnpm global bin.

### 2. Future: `pnpm add -g logbook`

This works once LogBook is published to the npm registry. Until then, the package is `name: "logbook"`, `version: "0.1.0"`, not yet pushed. Track the repository for release announcements.

```sh
# Not yet available — will work after the first npm publish.
pnpm add -g logbook
```

### 3. Ad-hoc per-project usage

If you don't want a global install, invoke the CLI bundle directly. Useful for CI or for testing a specific LogBook revision.

```sh
node /abs/path/to/LogBook/dist/cli/index.cjs <command>
```

You can alias this in your shell, but the global link is simpler.

## Your first 5 minutes

Once the binary is installed, the loop is:

1. `cd /to/your/project` — any TypeScript / JavaScript / Python / Go project works. LogBook does not care what stack you use; it captures Claude Code activity, not source code.
2. Run LogBook for the first time. Two options:

   ```sh
   logbook                       # zero-arg → opens the TUI wizard
   # — or —
   logbook init --preset standard --yes
   ```

   The TUI wizard walks you through preset choice and confirmation. `init --yes --preset standard` does the same non-interactively.

3. Open the project in Claude Code. The MCP server `logbook-mcp` is registered project-scoped in `.claude/mcp.json`; the PostToolUse hook is registered in `.claude/settings.local.json`; the agent will pick both up on session start.

4. Work normally. The agent captures decisions, errors, lessons, and resources automatically via MCP tool calls (driven by the installed Skill). The hook captures every tool call as raw evidence in `logbook/evidence/events.jsonl`.

5. After a working session, regenerate the docs:

   ```sh
   logbook              # opens TUI dashboard — press [b] to build
   # — or —
   logbook build        # non-interactive
   ```

6. To see the result, open `logbook/docs/index.md`, or produce a self-contained HTML you can share:

   ```sh
   logbook export html
   logbook export instructor-pack
   ```

   Outputs land in `logbook/exports/`.

## Choosing your preset

The single most important decision the first-time user makes. Each preset is a fixed bundle of artifacts; you can move between them by running `logbook uninstall --force` then `logbook init --preset <other>`.

| Preset | What it installs | Fixed-context tokens | When to use |
|--------|-------------------|----------------------|-------------|
| `minimal` | Hook (`PostToolUse`) + `.gitignore` entry. | 0 | You don't use Claude Code, or you want manual CLI capture only with zero context overhead on the agent. |
| `standard` | minimal + MCP server + 8 slash commands + Skill (`SKILL.md` + `reference.md`) + CLAUDE.md augment block. | 381 | The "use LogBook with Claude Code" default. Captures decisions, errors, lessons, resources automatically via MCP tools driven by the Skill. |
| `teaching` | standard + 2 subagents (`logbook-curator`, `logbook-teacher`) + statusline + `SessionStart` hook for cross-session memory. | 499 | You are recording a project arc for later teaching, or you want the full pedagogical stack with persistent context across sessions. |

`full` is a forward-compatible alias for `teaching`.

Notes:

- The 500-token budget is an enforced ceiling (§23, §37). Teaching sits at 499 with a 1-token margin.
- All presets are byte-identically reversible (§24.8, §37). `logbook uninstall --force` restores every shared file to its pre-install bytes.

## Setting up the LLM

LogBook works fully offline except for three commands: `logbook summarize milestone`, `logbook summarize project`, and `logbook teaching-script`. Those call a configured LLM provider.

There are three resolution paths, tried in order:

1. **`@anthropic-ai/claude-agent-sdk` with an active Claude Code subscription.** If your shell session is logged into Claude Code (Pro / Max / Team / Enterprise plan), LogBook uses the SDK credit. No API key required. This is the recommended path.
2. **`ANTHROPIC_API_KEY` environment variable.** Set it in your shell or via direnv:
   ```sh
   export ANTHROPIC_API_KEY=sk-ant-...
   ```
   LogBook reads it lazily, only when an LLM call is needed.
3. **Disabled.** If neither path resolves, `summarize` and `teaching-script` print a clear error and exit 1. All other commands continue to work.

Test the configured provider end-to-end without spending tokens:

```sh
logbook providers test --json
```

A successful response prints `ok: true` with `provider`, `model`, and a `latencyMs`. A failure prints `ok: false` with the error code (most commonly `no_auth`).

You can swap models per task in `.logbook/providers.json`:

```sh
logbook providers set task:teaching-script anthropic-claude-sdk --model claude-opus-4-6
logbook providers list
```

## Common first-time gotchas

The five most-reported issues, in order of frequency. Full troubleshooting catalog in [`07-troubleshooting.md`](./07-troubleshooting.md).

### 1. `logbook` command not found

Symptom: `command not found: logbook` after install.

Fix: from the LogBook repo, run `pnpm link --global`. Confirm with `which logbook`. If still missing, check that your pnpm global bin (`pnpm bin -g`) is on `PATH`.

### 2. MCP server doesn't start

Symptom: Claude Code shows the `logbook-mcp` server as failed to connect, or tool calls return errors.

Fix: run `logbook doctor`. It verifies every artifact, including that the MCP server bundle (`dist/mcp/server.cjs`) exists and is reachable. The most common cause is a stale install after moving the LogBook clone — run `logbook uninstall --force` from the project, then `logbook init` again, so the manifest captures the new absolute paths.

### 3. The agent doesn't auto-capture

Symptom: you make decisions in chat, but `logbook/events.jsonl` doesn't grow with `manual.decision` events.

Fix: restart the Claude Code session. The MCP server registration and the Skill are loaded at session start. The Skill's triggers (decision patterns, alternatives compared, errors observed) must be present in the conversation; review `.claude/skills/logbook-auto-capture/SKILL.md` to see exactly when the agent will fire MCP tools.

### 4. `pnpm test:e2e` fails locally

Symptom: e2e suite shows `mcp-rate-limit` red on heavy CI machines.

Fix: this is a known timing-sensitive test, carried as warning W1 since iter3. Re-run; it passes in isolation. Documented in [`06-construction-log.md`](./06-construction-log.md) and tracked for post-MVP cleanup (`retry: 2` or `concurrent: false` in vitest config).

### 5. Token budget warning

Symptom: `logbook doctor --measure` reports something above 500 for the teaching preset.

Fix: this is a hard CI gate. Run with `--json` to get the breakdown:

```sh
logbook doctor --measure --json
```

The fields `skill`, `augmentClaudemd`, `mcpToolDescriptions`, `slashCommandDescriptions`, `sessionStart`, etc. sum to `fixedContextTokens`. Identify the offender and either trim the corresponding asset under `assets/` or open an issue — exceeding 500 is a release blocker per spec §23.1.

---

Next: [`02-concepts.md`](./02-concepts.md) for the conceptual model, or [`03-cli-reference.md`](./03-cli-reference.md) for the full command surface.
