# 08 — Teaching preset hands-on walkthrough

A complete, opinionated walkthrough for someone who just installed the `teaching` preset and wants a concrete path from "installed" to "exporting an instructor pack at the end of the week". The other docs cover the moving parts; this one is the storyline that ties them together with a worked example.

If you're brand new, read [`01-getting-started.md`](./01-getting-started.md) first for prerequisites and install paths. If you already installed and Claude Code is running, jump straight to §3.

## 1. What `teaching` actually installs

The `teaching` preset installs 18 artifacts (vs 14 for `standard`, 2 for `minimal`). The extras are what makes the preset useful for instructors / didactic projects:

| Artifact | Where it lands | What it does |
|----------|----------------|--------------|
| `PostToolUse` hook | `.claude/settings.local.json` | Captures every tool call (Bash, Write, Edit, Read, WebFetch, …) into `logbook/evidence/events.jsonl` with redaction applied. p95 < 200 ms; never exits non-zero. |
| `SessionStart` hook | `.claude/settings.local.json` | Injects a ≤ 120-token summary of the current phase + last session into the agent's context on every new Claude Code session. The agent remembers where you left off. |
| `logbook-mcp` MCP server | `.claude/settings.local.json` `mcpServers` | Exposes the MCP tools the agent calls to record decisions, errors, fixes, lessons, milestones. Stdio transport, valibot-validated, rate-limited 20/sec. |
| Skill `logbook-auto-capture` | `.claude/skills/logbook-auto-capture/` | The pedagogical instructions that tell the agent **when** to call the MCP tools (after a real decision, not after every line of code). |
| 8 slash commands | `.claude/commands/lb-*.md` | Manual capture shortcuts: `/lb-decision`, `/lb-error`, `/lb-fix`, `/lb-lesson`, `/lb-milestone`, `/lb-phase`, `/lb-review`, `/lb-status`. |
| Subagent `logbook-curator` | `.claude/subagents/logbook-curator.md` | Curates pending suggestions — promotes the durable ones, discards the noisy ones. Invoked on demand. |
| Subagent `logbook-teacher` | `.claude/subagents/logbook-teacher.md` | Generates didactic material (lesson outlines, exercise sets) from captured decisions + errors + lessons. Invoked on demand. |
| Statusline | `.claude/settings.local.json` `statusLine` | Shows `phase=… │ session=… │ events=… │ pending=…` live in Claude Code's UI while you work. |
| `CLAUDE.md` augment block | `CLAUDE.md` (created if absent) | Idempotent block, between `<!-- logbook:generated start -->` / `end -->` markers, that tells the agent LogBook is active. ~40 tokens. |
| `.gitignore` block | `.gitignore` (created if absent) | Appends `.logbook/` + `logbook/` so internal scratch and data dirs are not committed. |

Total **fixed agent context** added: ≤ 500 tokens (Skill + augment block + MCP tool descriptions + SessionStart memory). Verify with `logbook doctor --measure`.

## 2. First-time install

```sh
# In the project where you will work:
cd /path/to/your-project

logbook init --preset teaching --yes
```

This is one command. Behind the scenes:

1. Detects every shared file's pre-install state (each installer scans its own slot).
2. Snapshots every shared file under `.logbook/backups/<sha256>-<basename>` for byte-exact rollback.
3. Installs the 18 artifacts in dependency order. If anything fails, rolls back in reverse.
4. Writes `.logbook/install-manifest.json` recording exactly what landed where.

If the project already has LogBook installed and a manifest exists, `init` is idempotent — it will skip artifacts that are already in place. If the manifest is missing but content is present (e.g. a previous bad uninstall), `init` will **skip** the orphan artifacts (it will not append duplicates). Run `logbook uninstall --force` first to clear orphans, then `init` again.

## 3. Restart Claude Code

> **Required.** The MCP server, the Skill, and the `SessionStart` hook all load at the start of a Claude Code session. Reopening the same window is not enough — close it and start a fresh session in the project directory.

Once Claude Code is back:

- The statusline shows the LogBook state inline (e.g. `phase=bootstrap │ session=0m │ events=0 │ pending=0`).
- The agent has the LogBook augment block, the Skill, and the MCP tool descriptions in its fixed context (~500 tokens total).
- The `SessionStart` hook ran once and injected the recovery summary (empty on session #1).

## 4. The daily flow — automatic capture

The default mode is **silent**. You work normally, Claude Code helps you, and LogBook records in the background. You do **not** run any LogBook command during the day.

What runs automatically:

- Every tool call → appended to `logbook/evidence/events.jsonl` by the `PostToolUse` hook. Redaction (Gitleaks-derived rules + entropy detection) runs before the line is persisted.
- The Skill instructs the agent to call MCP tools when it observes a pattern worth keeping:

| Pattern the agent sees | MCP call it makes |
|------------------------|-------------------|
| Compared alternatives and chose one with reasoning | `logbook_decision` |
| Tool failed with a meaningful error message | `logbook_error` |
| You (or the agent) fixed a previously recorded error | `logbook_fix` (linked by `error_id`) |
| You articulated a non-obvious insight in chat | `logbook_suggest("lesson", …)` — lessons need human ratification |
| A significant chunk of work closed | `logbook_suggest("milestone", …)` |
| The conversation pivoted to a new topic / phase | `logbook_suggest("phase", …)` |
| WebFetch / WebSearch consulted | `logbook_resource` |

The Skill instructs the agent to be conservative — routine actions (a `Bash ls`, an `Edit` typo fix) are **not** captured. Only durable learning.

## 5. Manual capture — when you want to force a record

The 8 slash commands let **you** record without waiting for the agent:

```text
/lb-decision    → record an architectural decision now
/lb-error       → record a didactic error
/lb-fix         → record the fix of an error
/lb-lesson      → record a lesson you (the human) want to keep
/lb-milestone   → mark a milestone
/lb-phase       → change the current phase label
/lb-review      → open the review screen (see §7)
/lb-status      → show current state inline
```

Each one just invokes the matching MCP tool. The agent will prompt you for the required fields.

## 6. Worked example — learning Rust, one hour

Concrete scenario: you sit down to learn Rust by building a CLI that parses JSON. Claude Code is helping you. You have `teaching` installed, you've just opened a fresh session, and the statusline reads `phase=bootstrap │ session=0m │ events=0`.

```text
You:    Let's start a Rust CLI tool that reads a JSON config file
        and prints the parsed values.

Agent:  Two reasonable choices for the JSON layer:
          - serde_json — declarative, derive-based, fastest path
          - nom — combinator parser, more flexible if you need
            custom formats later
        For a config reader I'd go with serde_json. Less boilerplate,
        idiomatic, and the perf is fine.

        [Skill detects: alternatives compared + decision made]
        → logbook_decision(
            title="serde_json vs nom for JSON parsing",
            context="CLI tool for reading config files",
            chosen="serde_json",
            consequences="Less control over parse errors; fine for fixed config schema"
          )

You:    great, let's go with serde_json.

Agent:  *writes Cargo.toml, src/main.rs, src/config.rs*
        *runs `cargo build`*

        Compile error:
        error[E0277]: the trait bound `Config: Deserialize<'_>` is not satisfied
          --> src/main.rs:12:24

        [Skill detects: meaningful tool failure]
        → logbook_error(
            kind="compile",
            message="error[E0277]: Config does not implement Deserialize",
            file="src/main.rs", line=12
          )

Agent:  This is the classic serde derive trap — the struct needs
        #[derive(Deserialize)]. Let me add it.

        *edits src/config.rs, re-runs cargo build, passes*

        → logbook_fix(
            error_id="<id from previous logbook_error>",
            description="Added #[derive(Deserialize)] to the Config struct"
          )

You:    [you realize this is worth keeping]
        /lb-lesson

Agent:  What's the lesson?

You:    title=Always derive Deserialize on serde target structs.
        body=The compiler error E0277 with a missing trait bound for
        Deserialize is serde's way of saying "you forgot #[derive]".
        It's the #1 first-time serde gotcha.

        → logbook_lesson(title=…, body=…)

You:    /lb-milestone

Agent:  Title? Description?

You:    title=First JSON parser working.
        description=Reads config.json, prints all keys + values to stdout.

        → logbook_milestone(title=…, description=…)
```

After this single hour you have on disk:

- `logbook/evidence/events.jsonl` — ~30-50 raw event lines (every tool call you and the agent made)
- `.logbook/state.json` — current `phase`, `session_id`, last-event timestamp
- One `decision` event (serde_json vs nom)
- One `error` event + linked `fix` event (the E0277)
- One `lesson` event (the derive Deserialize gotcha)
- One `milestone` event

The statusline now reads something like `phase=bootstrap │ session=58m │ events=42 │ pending=0`.

## 7. End-of-day — review and build

When you stop for the day:

```sh
logbook
```

The TUI dashboard opens (cyan ASCII banner animates for ~640 ms, then the home screen). Press:

- **`r`** → review screen. Each pending suggestion (anything captured via `logbook_suggest`) appears with the context. You promote durable ones to canonical events, discard noise, and tag each with `teachingValue` (high / medium / low). This is the human-in-the-loop step.
- **`b`** → build. Regenerates `logbook/docs/index.md`, `logbook/docs/timeline.md`, `logbook/docs/errors-and-lessons.md` from the canonical events. Generation is **idempotent** and deterministic — hand-edited prose **outside** the `<!-- logbook:generated -->` markers is preserved literally.

Non-interactive equivalents:

```sh
logbook review
logbook build
```

If you want to also commit a Markdown trace of your decisions, the `decisions/` directory has them in Nygard ADR format (`logbook/decisions/NNNN-<slug>.md`).

## 8. End-of-week — share with students or teammates

```sh
logbook export instructor-pack
```

Outputs `logbook/exports/instructor-pack.html` — a single self-contained file with:

- Project arc (timeline.md rendered)
- All ADRs (decisions in Nygard format)
- Teaching scripts generated from the captured decisions, errors, and lessons
- Generated TOC

Zero external references — double-click it and it opens. Ship it via email, Notion, whatever.

If the project has sensitive paths or emails:

```sh
logbook export instructor-pack --safe
```

Absolute paths, usernames, and email addresses are redacted in the HTML. The substitution log lands in `logbook/exports/safe-report.md` so you can audit what was changed before sending.

## 9. Tips specific to the `teaching` preset

These leverage the artifacts that only `teaching` installs:

1. **Call the `logbook-teacher` subagent for lesson generation.** From any Claude Code chat: *"Use the logbook-teacher subagent to draft a 30-minute lesson from the last 5 milestones."* It reads the canonical events and produces a structured outline with talking points + exercise ideas.

2. **Call `logbook-curator` for batch curation.** Useful at end-of-week instead of going through `/lb-review` one by one: *"Use the logbook-curator subagent to curate the last 7 days of pending suggestions. Promote high-signal items, discard the rest with reasons."*

3. **The statusline is your live thermometer.** While coding, glance at it. `pending=15` after one session means the Skill is over-capturing — go to review and prune. `pending=0` after a full day means the Skill is under-capturing — explicitly mention decisions / lessons in chat so the agent picks them up.

4. **The SessionStart hook helps continuity.** Every time you open a new Claude Code session, the agent sees a brief recap ("Last session: phase=auth, 3 decisions, 1 milestone reached"). You don't have to re-explain context.

5. **Do not edit the LogBook block in `CLAUDE.md`.** Anything you add inside `<!-- logbook:generated start --> … <!-- logbook:generated end -->` will be overwritten on the next install / rebuild. Add your own instructions outside the markers — they're preserved.

## 10. Health checks

Verify everything is wired up:

```sh
logbook doctor --measure
```

This reports:

- Each artifact's state (installed / drifted / missing).
- The fixed agent context token total. Hard gate: ≤ 500. The TUI's token-budget bar reflects this.
- Bundle size warning if any built file exceeds the soft cap.
- Manifest integrity check.

Inspect the current state at any time:

```sh
logbook state           # full JSON
logbook state --inline  # short one-line string (used by the statusline)
```

## 11. When the project ends

```sh
# Removes the installed artifacts. Your captured data (events, decisions,
# lessons, docs, exports) stays under `.logbook/` and `logbook/`.
logbook uninstall --force

# Or, if you want to wipe absolutely everything (DESTRUCTIVE):
logbook purge --force
```

`uninstall` restores every shared file to byte-identical pre-install state (e2e-verified by the `byte-identity-*` test suite). Other tools' content in `.claude/settings.local.json`, `CLAUDE.md`, `.gitignore` is untouched.

## 12. Recommended cadence

A pattern that works well for instructional projects:

| When | What |
|------|------|
| Once per project | `logbook init --preset teaching --yes` |
| Every Claude Code session | (nothing — automatic) |
| End of each working session | Quick glance at the statusline; if `pending` is high, `/lb-review` |
| End of day | `logbook review` (5–10 min); `logbook build` |
| End of week | `logbook export instructor-pack [--safe]` |
| End of project | `logbook uninstall --force` |

The point of LogBook is that the **session-to-session overhead is zero**. The curation is the only human-in-the-loop step and it batches naturally.

## Related docs

- [`01-getting-started.md`](./01-getting-started.md) — install paths, preset comparison, common gotchas.
- [`02-concepts.md`](./02-concepts.md) — what each artifact is, the data flow, token budget, byte-identity guarantee.
- [`03-cli-reference.md`](./03-cli-reference.md) — every command, every flag, exit codes.
- [`04-flows-by-role.md`](./04-flows-by-role.md) — flows for developer / instructor / student-reading-pack.
- [`07-troubleshooting.md`](./07-troubleshooting.md) — what to do when something breaks.
