# 04 — Flows by role

Three real-world end-to-end flows. Pick the one that matches your context. Each flow is concrete; commands are runnable in order.

## A. Developer (solo, using Claude Code daily)

You are building a project with Claude Code. You want LogBook to capture the construction silently and produce shareable documentation at the end of each week.

### Day 0 — install once

```sh
cd /path/to/your-project
logbook init --preset standard --yes
```

That single command does the following:

1. Generates `.logbook/install-manifest.json`.
2. Appends a `PostToolUse` hook to `.claude/settings.local.json` (or creates it).
3. Registers the `logbook-mcp` server in `.claude/mcp.json`.
4. Writes 8 slash command files under `.claude/commands/lb-*.md`.
5. Writes 2 Skill files under `.claude/skills/logbook-auto-capture/`.
6. Inserts an idempotent block into `CLAUDE.md`.
7. Appends `.logbook/`, `logbook/`, and a tag comment to `.gitignore`.
8. Backs up every shared file under `.logbook/backups/` first.

Start a fresh Claude Code session in the project. The MCP server and the Skill load at session start.

### Days 1–5 — work normally

You don't run any LogBook command. The capture is automatic:

- **The PostToolUse hook** appends every tool call (Bash, Write, Edit, Read, WebFetch, etc.) to `logbook/evidence/events.jsonl` with redaction applied.
- **The Skill** instructs the agent to call MCP tools when it observes patterns:
  - Compared alternatives and chose one → `logbook_decision`
  - Tool failure pattern observed → `logbook_error` + `logbook_fix`
  - WebFetch/WebSearch consulted → `logbook_resource`
  - Phase shift in the conversation → `logbook_suggest("phase", ...)`
  - Significant work completed → `logbook_suggest("milestone", ...)`
  - User authored a lesson → `logbook_suggest("lesson", ...)` (lessons are human-only)

Each MCP call goes through the same dispatcher pipeline: rate-limit (20/sec), payload size (≤ 8 KB), valibot strict validation, redaction, audit event written **before** the side effect.

What you see externally: `.logbook/state.json` keeps current phase and session; the statusline (if teaching preset) shows it inline; the SessionStart hook injects a ≤ 120-token summary into the agent's context on each new session so it remembers what happened.

### End of week — curate and build

After a week's work, run the dashboard:

```sh
logbook
```

The first thing you see is the animated LogBook banner (cyan ASCII art, 640 ms reveal) followed by the home screen showing: preset, manifest size, token budget bar, recent events. The banner version tag (`captain's log · v1.2.0`) updates automatically with each release. Set `LOGBOOK_NO_ANIMATION=1` to skip the reveal.

From the menu:

- Press `[r]` for review — promotes pending suggestions to canonical events, discards noise, tags `teachingValue` (high/medium/low).
- Press `[b]` for build — regenerates `logbook/docs/index.md`, `timeline.md`, `errors-and-lessons.md` deterministically.

Or do the same non-interactively:

```sh
logbook review
logbook build
```

The build is idempotent. Any hand-edited prose you put **outside** `<!-- logbook:generated -->` markers in those docs is preserved literally. The auto-generated content goes inside the markers.

### Share with the team

```sh
logbook export instructor-pack
```

Outputs `logbook/exports/instructor-pack.html` — a single self-contained file with the full project arc: docs, ADRs (Nygard format under `logbook/decisions/NNNN-<slug>.md`), teaching scripts (if any), and a generated TOC. Zero external references. Send it via the channel of your choice; the recipient just double-clicks it.

If the project contains sensitive paths or emails, add `--safe`:

```sh
logbook export instructor-pack --safe
```

Absolute paths, usernames, and email addresses are redacted; the substitution log lands in `logbook/exports/safe-report.md` so you can audit what was changed.

### When the project ends

```sh
logbook uninstall --force         # removes artifacts; data stays
# — or —
logbook purge --force             # full deletion (logbook/ + .logbook/)
```

`uninstall` restores every shared file to its pre-install bytes — byte-identically. Other plugins in `.claude/` are unaffected.

---

## B. Instructor designing a class

You are building a tutorial project. You will live-build it with Claude Code, then distribute it to students. You want every decision, error, and lesson captured automatically so the eventual class material is grounded in evidence, not memory.

### Step 1 — install with the teaching preset

```sh
cd /path/to/tutorial-repo
logbook init --preset teaching --yes
```

The teaching preset adds, beyond `standard`:

- Two subagents under `.claude/subagents/`:
  - `logbook-curator` — conversational alternative to the review TUI.
  - `logbook-teacher` — dedicated to generating teaching scripts.
- A `statusLine` entry that shows the current LogBook phase/session/pending count.
- A `SessionStart` hook that injects a ≤ 120-token state summary into every new Claude Code session, so the agent remembers across days where it left off.

Token budget: 499 / 500 — verified by `logbook doctor --measure`.

### Step 2 — work through the tutorial with Claude Code

Build the tutorial as a student would experience it. Make decisions out loud (the Skill picks up "let's go with X over Y because…" patterns). When something breaks, let the agent fix it — the error + fix get captured. Consult external docs — they get logged as resources.

At each natural break-point, mark a milestone:

```
/lb-milestone "Step 3 — auth flow working"
```

The `/lb-*` slash commands route through the MCP tools. The milestone becomes a natural target for `summarize` and `teaching-script`.

For decisions you want surfaced in class:

```
/lb-decision title="Use JWT over sessions" \
            alternatives="cookie-sessions, JWT, OAuth" \
            why="single-instance teaching project; scalability isn't the constraint, clarity is"
```

An ADR file is written to `logbook/decisions/0001-use-jwt-over-sessions.md` in Nygard format with an atomic counter.

### Step 3 — generate teaching scripts per milestone

```sh
logbook teaching-script last
```

LLM-backed. Reads the milestone's bracketed events, produces a structured teaching script: overview, key decisions, common pitfalls, lessons to emphasize, discussion prompts. Output lands in `logbook/teaching-scripts/`.

The companion command `logbook summarize milestone last` streams tokens to your terminal in real-time as the model generates them (v1.2+). Pass `--no-stream` if you're piping output to a script. The final markdown file is byte-identical regardless of streaming mode.

You can target any milestone by ULID:

```sh
logbook teaching-script 01HXYZ...
```

Tweak the model used:

```sh
logbook providers set task:teaching-script anthropic-claude-sdk --model claude-opus-4-6
```

### Step 4 — review and curate before distribution

```sh
logbook review
```

The TUI walks pending suggestions and unclassified events. Promote what should be in the script, discard noise, set `teachingValue` deliberately. Or use the conversational alternative:

> Use the `logbook-curator` subagent to walk pending items.

### Step 5 — annotate key moments (optional)

If you want to add context to a specific decision or error that was auto-captured, annotate it:

```sh
logbook annotate 01HXYZ... --note "This was the pivotal tradeoff — revisit in step 7."
```

You can find the event ULID from `logbook/docs/timeline.md` or by scanning `events.jsonl`. Annotations are preserved through export and visible in the instructor pack.

### Step 6 — export the instructor pack

```sh
logbook export instructor-pack --safe
```

`--safe` is important for distribution. It scrubs:

- Absolute paths (`/Users/jose/...` → `<HOME>/...`)
- Usernames
- Email addresses

The output is a single HTML file with: project index, full timeline, all ADRs, all errors + lessons, all teaching scripts, generated TOC. Mermaid diagrams in your docs are rendered as inline SVG. No external network references.

For a custom look, pass a CSS theme:

```sh
logbook export instructor-pack --safe --theme ./assets/class-theme.css
```

For speaker-note blocks (use `<!-- logbook:speaker start/end -->` to add presenter notes inside any doc):

```sh
logbook export instructor-pack --safe --speaker-mode
```

### Step 7 — export as PDF (optional)

If you want to distribute a PDF instead of HTML (requires Chrome):

```sh
logbook export pdf --safe --out ./class-material.pdf
```

See [`03-cli-reference.md`](./03-cli-reference.md#logbook-export-pdf) for Chrome installation notes.

### Step 8 — students get one file

That's the deliverable. One HTML (or PDF). No Node install, no Claude Code, no LogBook required on their side. Double-click → browser → full project history.

---

## C. Student reviewing an instructor-pack.html

You received `instructor-pack.html` from your instructor. You want to learn from the construction process, not just the finished code.

### 1. Open the file

Double-click the HTML — it works in any modern browser, fully offline. There is no JavaScript dependency on a CDN; everything is inlined.

### 2. Navigate

The pack contains:

- **Project index** — the high-level overview of what was built.
- **Timeline** — chronological session-by-session activity.
- **ADRs** — every architectural decision in Nygard format. Each has its rationale and the alternatives that were considered and rejected. This is the most pedagogically valuable section: you can see why an approach was chosen, not just what was chosen.
- **Errors and lessons** — every bug encountered, every fix applied, every lesson written down.
- **Teaching scripts** — LLM-generated per-milestone scripts with key decisions, common pitfalls, and discussion prompts.

Use the table of contents to jump between sections.

### 3. Read with the teaching script open

For each milestone in the project, the teaching script tells you:

- What goal the section achieves.
- The 2–3 decisions that mattered.
- The pitfalls the instructor hit (or expected you to hit).
- The lessons to emphasize.
- Discussion prompts to think about before continuing.

This is the curated pedagogical layer — the WHY behind each decision is grounded in the real evidence of how it was made.

### 4. Optionally clone and replay locally

If the original repo is shared with you, clone it and walk the construction yourself. The ADRs in `logbook/decisions/` tell you what was decided in each phase; the timeline in `logbook/docs/timeline.md` orders them chronologically. You can replay with your own Claude Code session and see how your decisions compare.

---

Next: [`05-architecture.md`](./05-architecture.md) for the internals, or [`06-construction-log.md`](./06-construction-log.md) for how LogBook itself was built.
