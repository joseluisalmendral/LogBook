# 07 — Troubleshooting

Top 10 gotchas, ordered by reported frequency. Each entry: symptom → diagnosis → fix.

---

## 1. `logbook` command not found

**Symptom.** Running `logbook` in any directory returns `command not found: logbook`.

**Diagnosis.**

```sh
which logbook                # should resolve to pnpm global bin
pnpm bin -g                  # confirms where global bins land
echo $PATH | tr ':' '\n' | rg pnpm
```

If `which logbook` returns nothing and `pnpm bin -g` is not on `PATH`, the link didn't propagate to your shell.

**Fix.**

```sh
cd /path/to/LogBook
pnpm install
pnpm build
pnpm link --global
```

Then either open a new shell or add `$(pnpm bin -g)` to your `PATH`:

```sh
export PATH="$(pnpm bin -g):$PATH"
```

If `pnpm link --global` itself fails, check that you ran `pnpm build` first — the link points to `dist/cli/index.cjs` which must exist.

---

## 2. MCP server doesn't boot

**Symptom.** Claude Code shows `logbook-mcp` as "failed to connect" or MCP tool calls return errors like `MCP server not responding`.

**Diagnosis.**

```sh
logbook doctor                              # verifies every artifact
node /abs/path/to/dist/mcp/server.cjs       # smoke test the server bundle
```

The doctor verifies each manifest entry via its installer's `verify()` method. A common cause is a stale install — the manifest still points to an old absolute path because the LogBook clone was moved.

**Fix.**

```sh
logbook uninstall --force
logbook init --preset standard --yes
```

This re-resolves all absolute paths (`dist/mcp/server.cjs`, `dist/connectors/claude-code/hook.cjs`) and writes a fresh manifest.

If the server bundle is missing entirely, rebuild:

```sh
cd /path/to/LogBook
pnpm build
```

---

## 3. Agent doesn't auto-capture

**Symptom.** You make decisions, hit errors, and consult resources during a Claude Code session, but `logbook/evidence/events.jsonl` only contains `mcp.tool_call` and PostToolUse events, no `manual.decision` events.

**Diagnosis.** The MCP server is connected, but the Skill that instructs the agent to call MCP tools is not loading. Two possible causes:

1. Skill files missing. Check `.claude/skills/logbook-auto-capture/SKILL.md` exists.
2. Session was started before the Skill was installed.

```sh
logbook status                              # confirm skill is in the manifest
fd SKILL.md .claude/skills                  # confirm the file exists
```

**Fix.** Restart the Claude Code session. The Skill loads at session start. If the Skill is missing from the manifest, re-run `logbook init --preset standard`.

The Skill's triggers must also match the conversation. Patterns like "let's go with X over Y because…" are picked up; arbitrary commits are not. Review `.claude/skills/logbook-auto-capture/SKILL.md` to see the trigger list.

---

## 4. p95 hook test fails

**Symptom.** `pnpm test:e2e` fails on `tests/e2e/ingest-p95.test.ts` with `p95 > 200ms`.

**Diagnosis.** The cold-start budget is 200 ms for the hook bundle. Causes:

- Underpowered or heavily loaded CI runner.
- Cold disk (first test run on a fresh container).
- Antivirus scanning every spawn.

```sh
node dist/connectors/claude-code/hook.cjs < /dev/null
time node dist/connectors/claude-code/hook.cjs < /dev/null
```

Run multiple times. Typical p95 on Darwin ARM is 44–49 ms.

**Fix.** If reproducible locally, re-run after a warm-up pass — `pretest:e2e` builds first, which is single-pass. If consistent across runs, profile the hook entrypoint:

```sh
node --prof dist/connectors/claude-code/hook.cjs < hook-payload.json
```

If the issue is environment-specific (cold disk, AV), the test is informational on that machine — it does not affect runtime behaviour.

---

## 5. `mcp-rate-limit.test.ts` flaky

**Symptom.** `tests/integration/mcp-rate-limit.test.ts` sometimes fails under heavy parallel test load.

**Diagnosis.** Known issue, carried as Warning W1 since iter3. The test uses a 1-second sliding window with sleep at 1300 ms. Under high parallel load, the timer can drift past the window edge.

**Fix.** Re-run; it passes cleanly in isolation:

```sh
pnpm test:integration -- mcp-rate-limit
```

Post-MVP fix scheduled: add `retry: 2` or `concurrent: false` for this suite in `vitest.config.ts`. Tracked in iter5 W1 and iter6 W1.

---

## 6. CRLF byte-identity test fails on Windows

**Symptom.** `tests/e2e/byte-identity-crlf.test.ts` (or one of the `*-crlf` integration tests) fails with byte differences on Windows CI.

**Diagnosis.** Git's `core.autocrlf=true` setting silently converted the CRLF fixtures to LF on checkout, breaking the test inputs.

```sh
git config core.autocrlf                   # should not be 'true'
git ls-files --eol tests/fixtures/         # confirm fixture line endings
```

**Fix.** The repository ships `.gitattributes` rules pinning the CRLF and LF fixture directories:

```
tests/fixtures/crlf/**            eol=crlf
tests/fixtures/crlf-standard/**   eol=crlf
tests/fixtures/statusline/**      eol=crlf
tests/fixtures/subagents/**       eol=lf
```

If you cloned before these rules existed, re-checkout the fixtures:

```sh
git rm --cached -r tests/fixtures
git checkout tests/fixtures
```

Or set `core.autocrlf=false` for the LogBook repo specifically:

```sh
cd /path/to/LogBook
git config core.autocrlf false
git checkout .
```

---

## 7. `better-sqlite3` native binding fails

**Symptom.** `pnpm install` or `pnpm test` fails with `Error: Cannot find module 'better_sqlite3.node'` or similar native binding errors.

**Diagnosis.** `better-sqlite3` is a native module that compiles per-platform. Common causes:

- Node version mismatch (must be 22 LTS).
- Build toolchain missing (`gcc` / `g++` / `make` on Linux, Xcode CLI on macOS, MSVC on Windows).
- pnpm fetched the wrong prebuilt binary.

```sh
node --version                             # must be v22.x
pnpm list better-sqlite3                   # confirms installed version
```

**Fix.**

```sh
pnpm rebuild better-sqlite3
# — or, if that fails —
pnpm install --force
```

On Linux: install build-essential first (`apt install build-essential` or equivalent).

On macOS: ensure `xcode-select --install` is run.

If the native module persistently refuses to build, LogBook still works — JSONL is the canonical source. SQLite is a best-effort index; commands degrade with `warning: SQLite index failed (non-fatal)` and continue.

---

## 8. TUI doesn't render

**Symptom.** Running `logbook` (zero-arg) or `logbook review` shows a blank screen, garbled output, or hangs.

**Diagnosis.** Three common causes:

- **Terminal too narrow.** Ink components assume ≥ 80 columns. Resize and re-run.
- **Not a real TTY.** Piping input or running under a tool that virtualizes the terminal (e.g., some CI containers) disables the TUI. `logbook` zero-arg falls through to citty help in that case; `logbook review` prints a count and exits.

  ```sh
  test -t 0 && echo "stdin TTY" || echo "stdin NOT TTY"
  test -t 1 && echo "stdout TTY" || echo "stdout NOT TTY"
  ```

- **Terminal does not support ANSI cursor codes.** Older Windows consoles or weird remote shells.

**Fix.** Use a modern terminal (iTerm2, Alacritty, kitty, modern Windows Terminal). On Windows, prefer Windows Terminal over `cmd.exe`. If stuck on a non-TTY environment, use the CLI commands directly — every TUI action has a CLI equivalent:

| TUI action | CLI equivalent |
|------------|-----------------|
| `[i]` install | `logbook init --preset <name> --yes` |
| `[b]` build | `logbook build` |
| `[e]` export | `logbook export html` or `logbook export instructor-pack` |
| `[r]` review | `logbook review` (still TUI) — or use the `logbook-curator` subagent |
| `[d]` doctor | `logbook doctor --measure` |
| `[u]` uninstall | `logbook uninstall --force` |

---

## 9. Token budget exceeded

**Symptom.** `logbook doctor --measure` reports `fixedContextTokens > 500` for the teaching preset, or the CI gate `doctor-measure-teaching.test.ts` fails.

**Diagnosis.** Some asset grew past its budget. Get the breakdown:

```sh
logbook doctor --measure --json
```

Look at the fields:

```
skill                   <- chars(SKILL.md) / 4 ; trim assets/skill/SKILL.md
augmentClaudemd         <- chars(block body) / 4 ; trim assets/claudemd/augment.md
mcpToolDescriptions     <- sum across 9 tools ; trim a description in src/mcp/tools/*.ts
slashCommandDescriptions<- sum across 8 slash files ; trim YAML descriptions in assets/slash/*.md
sessionStart            <- constant 120 ; reduce SESSION_START_CONSERVATIVE_MAX_TOKENS only if measurement supports it
```

**Fix.** Identify the offender. Trim the corresponding asset. Re-measure. Re-run the CI gate test.

Exceeding 500 is a release blocker per spec §23.1. The 1-token margin at 499 is intentional — every new feature must amortize its cost.

---

## 10. Uninstall doesn't fully clean

**Symptom.** After `logbook uninstall --force`, some artifacts remain — typically a stray `_logbookId` entry in `.claude/settings.local.json`, or a hook file `.claude/commands/lb-*.md` that wasn't deleted.

**Diagnosis.** The uninstall reads the manifest. If the manifest is missing, corrupted, or out of sync with disk (someone hand-edited the artifacts), the engine can't locate them by their anchors.

```sh
logbook status                              # what does the manifest say?
fd 'lb-' .claude                            # what's actually on disk?
fd -e md . .claude/commands                 # any lb-*.md files left?
```

**Fix.** Two paths:

1. **Manual cleanup.** Any file starting with `lb-` under `.claude/commands/`, `.claude/skills/logbook-auto-capture/`, `.claude/subagents/` belongs to LogBook. Any JSON entry with `_logbookId` in `.claude/settings.local.json` or `.claude/mcp.json` belongs to LogBook. Remove them by hand.

2. **Force a clean state with `purge --force`.**

```sh
logbook purge --force
```

This wipes `.logbook/` (manifest, backups, providers config, SQLite) AND `logbook/` (events, generated docs, exports). Then start over with `logbook init`.

If `purge` itself errors out (rare — best-effort design), delete the directories manually:

```sh
rm -rf .logbook logbook
```

The `.claude/` artifacts will then be orphans — see step 1 above for manual cleanup.

---

## 11. `logbook export pdf` — Chrome not found

**Symptom.** Running `logbook export pdf` exits with:

```
Error: PDF export requires Chrome or Chromium.
Set CHROME_PATH=/path/to/chrome, or install Chrome:
  macOS:  brew install --cask google-chrome
  Linux:  apt install chromium-browser  (or equivalent)
```

**Diagnosis.** `logbook export pdf` looks for Chrome in this order:

1. `CHROME_PATH` env var.
2. `puppeteer-core`'s `executablePath()` — returns the path of a bundled Chrome if present (not present in LogBook's config since we externalize puppeteer-core).
3. Fails fast with the message above.

**Fix.**

```sh
# macOS
brew install --cask google-chrome
# Linux (Debian/Ubuntu)
apt install chromium-browser
# Or point to an existing Chrome installation:
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
logbook export pdf --out my-docs.pdf
```

If you don't need PDF, use `logbook export instructor-pack` (HTML — no Chrome required).

**Note on `puppeteer-core` install.** The module is an optional dependency. If you installed with `pnpm install --no-optional`, it is not present. Re-run `pnpm install` without that flag to restore it.

---

## 12. Codex CLI adapter — binary not found or JSON parse error

**Symptom A.** Setting up a `codex-cli` provider and calling `logbook providers test` returns:

```
error.code: codex_not_found
Install Codex CLI: https://github.com/openai/codex
```

**Diagnosis.** The Codex CLI subprocess adapter spawns `codex exec --non-interactive --json`. The `codex` binary was not found on `PATH`.

**Fix.** Install the Codex CLI:

```sh
npm install -g @openai/codex    # or per the official Codex CLI docs
which codex                     # confirm it is on PATH
logbook providers test --task teaching-script --json
```

**Symptom B.** The test returns `error.code: codex_parse_error` or `error.code: codex_exit`.

**Diagnosis.** The Codex CLI exited non-zero or produced non-JSON output. Possible causes: the model name is wrong, the API key is not configured in Codex CLI, or the CLI version changed its output format.

**Fix.** Run Codex CLI directly to see the raw output:

```sh
echo "Hello, respond with just 'pong'." | codex exec --non-interactive --json
```

If this fails, check your Codex CLI configuration (API key, model). If `--non-interactive --json` flags are not recognized by your version, open an issue — LogBook's Codex adapter contract is locked to these flags.

---

## 13. A project's Skill / slash commands seem out of date

**Symptom.** You pulled a new LogBook release and rebuilt (`git pull && pnpm build` in the LogBook repo), but a specific project still seems to use the old Skill rules, missing the slash command, or has a stale `<!-- logbook:augment -->` block in its `CLAUDE.md`.

**Cause.** The Skill, slash commands, and the `CLAUDE.md` augment block are **copied** into the project at install time, not symlinked. They don't auto-update when the LogBook repo rebuilds. (The CLI binary, the MCP server, and the hook behavior **do** auto-update — those resolve through the global symlink.)

See [`01-getting-started.md` § Keeping LogBook up to date](./01-getting-started.md#keeping-logbook-up-to-date) for the full two-layer mental model.

**Diagnostic.** Run the doctor to see hash drift:

```sh
cd /to/project
logbook doctor
```

It will list any artifact whose on-disk hash differs from the global binary's expected hash. Drift on `SKILL.md`, `lb-*.md`, or the `CLAUDE.md` augment block confirms the copy is stale.

**Fix (today).** Uninstall + reinstall in the affected project. Your captured data is preserved (uninstall does NOT touch `logbook/` or `.logbook/`):

```sh
cd /to/project
logbook uninstall --force
logbook init --preset standard --yes
```

Run `logbook doctor` again afterwards to confirm zero drift.

**Fix (v1.3+).** The planned `logbook self-update` subcommand will detect drift and refresh in place, no `uninstall` + `init` dance required. Tracked in [`v1.3-roadmap.md`](./v1.3-roadmap.md) §2.2.

---

## Where to ask for help

If your issue isn't covered here:

1. Check the spec sections referenced in error messages (e.g. `§24`, `§37`).
2. Run `logbook doctor --measure --json` and capture the output.
3. Check the recent commits — the construction log in [`06-construction-log.md`](./06-construction-log.md) explains the design decisions behind each iteration.
4. Open an issue with: your Node version, your pnpm version, the doctor JSON output, and the exact command that failed.

---

Back to [docs README](./README.md).
