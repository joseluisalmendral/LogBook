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

**First-time pnpm users on this machine:** if `pnpm link --global` fails with `ERR_PNPM_NO_GLOBAL_BIN_DIR`, run `pnpm setup` first (one-time per machine — creates the global bin directory and adds `PNPM_HOME` to your shell rc), then `source ~/.zshrc` (or close + reopen the terminal), then retry the link. Full diagnostic in [`07-troubleshooting.md` §1a](./07-troubleshooting.md#1a-err_pnpm_no_global_bin_dir-when-running-pnpm-link---global).

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

## Keeping LogBook up to date

After the initial install, "how do I update?" has two answers depending on which layer of LogBook changed. The mental model: **the global binary updates automatically; per-project artifacts do not.**

### Layer 1 — Global binary (symlink-backed, auto-updates)

`pnpm link --global` creates a symlink, not a copy. The `logbook` command in your `$PATH` resolves at every invocation to `dist/cli/index.cjs` inside the cloned repo. The same is true of `dist/mcp/server.cjs`, which is what `.mcp.json` in every installed project points at (via absolute path).

This means **any rebuild of the LogBook repo immediately propagates to every project**, with zero per-project action:

```sh
cd /Users/.../LogBook-repo
git pull                              # bring in upstream changes
pnpm install --frozen-lockfile        # only if package.json moved
pnpm build                            # rebuild dist/
# done — `logbook` and the MCP server now run the new bytes everywhere
```

Things that auto-update through this path:

| Change | How it propagates |
|--------|-------------------|
| Bug fix in CLI command logic | symlink → next `logbook <cmd>` invocation |
| Bug fix in the MCP server | `.mcp.json` absolute path → next Claude Code session start |
| Improvement in the PostToolUse hook ingestor | hook entry calls the global binary → next tool call |
| New CLI subcommand | symlink → available immediately |
| Changes to preset definitions | `init` reads them from the global binary → applies to new installs |

### Layer 2 — Per-project installed artifacts (copies, manual refresh)

When you ran `logbook init` in a project, several files were **copied** into the project tree (not symlinked). Those copies stay frozen at the version that was current when you ran `init`.

| File copied at install | Auto-updates? |
|-----------------------|---------------|
| `.claude/skills/logbook-auto-capture/SKILL.md` | ❌ no — it's a copy |
| `.claude/skills/logbook-auto-capture/reference.md` | ❌ no — it's a copy |
| `.claude/commands/lb-*.md` (8 slash commands) | ❌ no — they're copies |
| `<!-- logbook:augment -->` block inside `CLAUDE.md` | ❌ no — it's pasted text |
| `<!-- logbook:gitignore -->` lines in `.gitignore` | ❌ no — they're pasted lines |
| Hook entry in `.claude/settings.local.json` | ⚠ the line is fixed but it invokes the global binary, so the *behavior* updates |
| Server entry in `.mcp.json` | ✅ the line is fixed but it points at the global `dist/mcp/server.cjs`, so the *behavior* updates |

So if a release changes the Skill body or adds a new slash command, projects that were installed before that release **keep running the old Skill / old commands** until you refresh them.

### Refreshing a project to the latest artifacts (today's workaround)

Until `logbook self-update` lands in v1.3, the refresh path is:

```sh
cd /to/project
logbook uninstall --force                       # removes artifacts; preserves your data
logbook init --preset standard --yes            # reinstalls with the current artifacts
```

**Your captured data is safe.** Uninstall does NOT delete `logbook/` or `.logbook/`, so your events, ADRs, lessons, exports, and backups all survive the refresh. Only the *installed artifacts* (Skill, slash commands, CLAUDE.md block, hook entry, mcp.json entry, .gitignore lines) get torn down and rebuilt.

If you want a completely clean slate including captured data: `logbook purge --force`.

### Checking whether a project is stale

```sh
cd /to/project
logbook doctor
```

The doctor reads `.logbook/install-manifest.json` (which records the content hashes captured at install time) and compares them to what the global binary expects today. Hash drift is reported per artifact. Today the doctor only *reports* drift; in v1.3 it gains an `--upgrade` flag to fix it in place.

### Cheat sheet

| You want to… | Run this |
|-------------|----------|
| Pull a new LogBook release into your dev clone | `cd /to/LogBook-repo && git pull && pnpm build` |
| Update one project to the latest Skill / commands | `cd /to/project && logbook uninstall --force && logbook init --preset standard --yes` |
| Check if a project's artifacts match the current LogBook version | `cd /to/project && logbook doctor` |
| Drop LogBook entirely from a project, keep captured data | `logbook uninstall --force` |
| Drop LogBook entirely from a project, delete captured data too | `logbook purge --force` |
| Stop using LogBook globally | `pnpm uninstall --global logbook` (from any directory) |

### What v1.3 changes

The v1.3 release (see [`v1.3-roadmap.md`](./v1.3-roadmap.md)) addresses two friction points in this flow:

1. **`brew install logbook` / `scoop install logbook`** replace the manual clone + link, putting the binary at a stable path (`/opt/homebrew/bin/logbook` or equivalent). This eliminates the "if I move the repo, projects break" failure mode caused by the absolute path in `.mcp.json`.
2. **`logbook self-update`** adds an in-place upgrade path that detects stale per-project artifacts and refreshes them without requiring `uninstall` + `init`. Pairs with a startup update-check that flags new releases.

## Your first 5 minutes (slice 26+ lean install)

Once the binary is installed, the loop is dead simple:

1. `cd /to/your/project` — any project. LogBook captures Claude Code activity, not source code, so language / stack don't matter.

2. Run `logbook init`:

   ```sh
   logbook init --yes                     # standard preset (default)
   # — or —
   logbook                                # zero-arg → TUI wizard with animated banner
   ```

   What gets installed (slice 26 lean):
   - `.claude/settings.local.json` — registers **2 hooks** (`SessionStart` + `Stop`)
   - `.claude/mcp.json` — registers `logbook-mcp` server (project-scoped)
   - `CLAUDE.md` — appends `<!-- lb-augment -->` block with Skill guidance
   - `.gitignore` — appends `.logbook/` + `logbook/exports/`
   - Slash commands + Skill files copied to `.claude/`

3. **Restart Claude Code** so it picks up the new hooks + MCP. (Cerrá la sesión y volvé a abrir `claude`.)

4. **Work normally with Claude Code.** Capture is PASSIVE — you do nothing during the session. The transcript is recorded automatically by Claude Code itself. The `Stop` hook triggers the scraper at each turn-end, which backfills `user_prompt`, `claude_message`, `subagent_complete`, `agent_question`, `skill_invoked`, `tool_use`/`tool_result` to `logbook/evidence/events.jsonl`.

5. When you want to see the result:

   ```sh
   logbook build                          # backfills from transcripts + generates docs
   logbook export html --out salida.html  # editorial single-file HTML
   open salida.html
   ```

6. (Optional) For class presentations where you don't want local paths visible:

   ```sh
   logbook export html --safe --out clase.html       # redacts paths/emails/usernames
   # — or activate Teaching mode in the HTML sidebar (toggleable without re-export)
   ```

## Sessions you already had BEFORE installing LogBook

Slice 26's killer feature. The Claude Code transcript at `~/.claude/projects/<encoded>/<sessionId>.jsonl` exists **independently of LogBook** — Claude Code persists it before any hook fires. So:

```sh
# Installed LogBook on a repo with months of existing Claude Code sessions?
cd /to/long-running-project
logbook init --yes                       # 2 hooks for FUTURE sessions
logbook build                            # backfills ALL historical sessions from transcripts
logbook export html --out history.html   # → HTML with every conversation you've ever had

# Output example (real ai-learning-engine repo, no prior LogBook):
# "Backfilled 175 events from transcripts across 5 sessions."
```

What `logbook build` actually does (slice 23+26):
1. Enumerates every `~/.claude/projects/<encoded>/*.jsonl` for the current repo
2. Runs the transcript scraper on each, idempotent (dedup by `tool_use_id` + `(tool_name, timestamp-second)` fingerprint)
3. Backfills missed events with `payload.backfilledFromTranscript: true` flag
4. Generates `logbook/docs/*` markdown files

You can run `logbook build` whenever you want — it never duplicates. If a hook missed something, build recovers it.

## Choosing your preset

The single most important decision the first-time user makes. Each preset is a fixed bundle of artifacts; you can move between them by running `logbook uninstall --force` then `logbook init --preset <other>`.

| Preset | What it installs | Fixed-context tokens | When to use |
|--------|-------------------|----------------------|-------------|
| `minimal` | 2 hooks (`SessionStart` + `Stop`) + `.gitignore` entry. No MCP, no slash commands, no Skill. | 0 | You don't use Claude Code semantic tools, or you want pure replay capture with zero context overhead. |
| `standard` (default, slice 26 lean) | minimal + MCP server + 8 slash commands + Skill (`SKILL.md` + `reference.md`) + CLAUDE.md augment block + SessionStart context inject. | ~380 | The "use LogBook with Claude Code" default. Captures decisions, errors, lessons, resources via MCP tools when Claude calls them. |
| `teaching` | standard + 2 subagents (`logbook-curator`, `logbook-teacher`) + statusline. | ~499 | You are recording a project arc for later teaching, or you want the full pedagogical stack. |

`full` is a forward-compatible alias for `teaching`.

### What slice 26 changed (architectural simplification)

**Before slice 26 (v1.2.x):** 4 hooks — `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`. Real-time capture path.

**After slice 26 (v1.3+):** 2 hooks — `SessionStart` (context inject) + `Stop` (scraper trigger). Transcript-first capture path.

Why: `PostToolUse` and `UserPromptSubmit` were redundant — Claude Code persists the transcript before any hook fires, so the scraper (which runs at `Stop`) can synthesize identical events with dedup. Removing them = leaner install, fewer points of failure, identical export output. Verified across 9 real sessions, byte-equivalent.

If you specifically need real-time capture (e.g. live dashboard surfaces showing tools as they fire), you can still use a 4-hook install — open an issue or hand-edit `.claude/settings.local.json` after `init`. For the export use case (replay after the session), 2 hooks is strictly better.

### Verifying the install

```sh
logbook status                           # shows what's installed + recent activity
logbook doctor                           # diagnostic health check
logbook doctor --measure                 # full token budget + bundle sizes
```

If hooks didn't register (Claude Code wasn't restarted), `logbook doctor` flags missing entries.

Notes:

- The 500-token budget is an enforced ceiling (§23, §37). Teaching sits at ~499 with a 1-token margin.
- All presets are byte-identically reversible (§24.8, §37). `logbook uninstall --force` restores every shared file to its pre-install bytes.

## Workflow recap for your colleague (TL;DR)

```sh
# ONE TIME, system-wide
git clone https://github.com/joseluisalmendral/LogBook.git
cd LogBook
pnpm install && pnpm build && pnpm link --global

# IN EACH PROJECT
cd /path/to/repo
logbook init --yes
# (restart Claude Code for hooks to register)

# WHEN YOU WANT THE HTML
logbook build
logbook export html --out ~/Desktop/replay.html
open ~/Desktop/replay.html
```

That's it. Whether the repo is fresh or has 6 months of Claude Code sessions already, `logbook build` recovers everything from transcripts. No risk of data loss; no manual capture during sessions.

## Troubleshooting first run

| Symptom | Fix |
|---|---|
| `logbook: command not found` | `pnpm link --global` failed. Run `pnpm setup` (one-time), close+reopen terminal, retry. |
| Hooks not firing in Claude Code | Restart Claude Code (cerrar la sesión y reabrirla). Hooks register at startup only. |
| `logbook build` says "0 events" | Either: (a) no Claude Code sessions exist for this repo yet, or (b) the project root doesn't match what Claude Code recorded. Check `~/.claude/projects/` for an encoded folder matching your repo path. |
| HTML missing tool details | Run `logbook build` first; it backfills tools from transcript. |
| Repo path changed and now things break | Claude Code encodes the absolute path. If you moved the repo, old transcripts stay under the OLD encoded folder. Recopy them or re-run sessions under the new path. |

For deeper issues see [`07-troubleshooting.md`](./07-troubleshooting.md).

## Setting up the LLM

LogBook works fully offline except for three commands: `logbook summarize milestone`, `logbook summarize project`, and `logbook teaching-script`. Those call a configured LLM provider.

### Supported providers

| Provider | Kind | Auth required | Notes |
|----------|------|---------------|-------|
| Anthropic (Claude) | `anthropic` | `ANTHROPIC_API_KEY` **or** Claude Code session | Recommended path. Claude Code Pro/Max/Team/Enterprise sessions use the SDK credit — no API key needed. |
| OpenAI | `openai` | `OPENAI_API_KEY` | Standard API key. ChatGPT Plus subscription is **not** programmatic — it does not provide an API key. You need a separate API key from [platform.openai.com](https://platform.openai.com). |
| Azure OpenAI | `azure` | `OPENAI_API_KEY` + `base_url` in config | Same `@ai-sdk/openai` under the hood; requires `base_url` set to your Azure endpoint. |
| Google Gemini | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | API key from [aistudio.google.com](https://aistudio.google.com). Free tier available without credit card, but ⚠ free-tier prompts are used by Google for model training (paid tier is not — see [`02-concepts.md` § Gemini API free tier](./02-concepts.md#gemini-api-free-tier--what-you-actually-get) for the full caveat). Uses `@ai-sdk/google`. |
| Ollama (local) | `local` | None (requires Ollama running on `:11434`) | No API key. Runs entirely offline. Start with `ollama serve`; pull a model with `ollama pull llama3.2`. The default base URL is `http://localhost:11434/v1`. |
| Codex CLI | `codex-cli` | OpenAI API key (via Codex CLI config) | Subprocess adapter — delegates to the `codex` binary. Coming in v1.1-SG1b. |

### Auth resolution order

When LogBook makes an LLM call, it resolves auth in this priority order:

1. **Claude Code session** — if `CLAUDE_CODE_SESSION_ID` or `CLAUDECODE` env is set (you are inside a Claude Code session), LogBook uses `@anthropic-ai/claude-agent-sdk`. No API key needed. This is the zero-config path.
2. **`ANTHROPIC_API_KEY`** — used for `anthropic` kind providers when present.
3. **`OPENAI_API_KEY`** — used for `openai` and `azure` kind providers when present.
4. **`GOOGLE_GENERATIVE_AI_API_KEY`** — used for `google` kind providers when present.
5. **Ollama local** — `local` kind providers resolve without a key; the placeholder value `"ollama"` is passed to satisfy the SDK parameter but is not sent to any remote server.
6. **Provider-specific env var** — the `api_key_env` field in `providers.json` is checked as a final fallback.
7. **None** — `summarize` and `teaching-script` print `error.code: no_auth` and exit 1. All other commands continue to work.

### Quick setup by provider

**Anthropic (recommended if you have Claude Code):**
No setup needed — works automatically inside a Claude Code session.

**Anthropic API key:**
```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

**Google Gemini:**
```sh
export GOOGLE_GENERATIVE_AI_API_KEY=AIza...
logbook providers set task:teaching-script gemini-default --model gemini-2.0-flash
```

**Ollama (local, no API key):**
```sh
ollama serve          # start the Ollama server (if not running as a service)
ollama pull llama3.2  # pull the model you want
logbook providers set task:teaching-script ollama-local --model llama3.2
# providers.json entry: { "kind": "local", "base_url": "http://localhost:11434/v1", ... }
```

Test the configured provider end-to-end:

```sh
logbook providers test --json
# or test a specific routing entry:
logbook providers test --task teaching-script --json
```

A successful response prints `ok: true` with `provider`, `model`, and a `latencyMs`. A failure prints `ok: false` with the error code (most commonly `no_auth`).

You can inspect or swap routing rules at any time:

```sh
logbook providers list
logbook providers set task:teaching-script anthropic-claude-sdk --model claude-opus-4-6
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
