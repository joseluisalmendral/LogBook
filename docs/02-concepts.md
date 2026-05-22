# 02 — Concepts

The conceptual model behind LogBook, in the order it helps to learn it.

## What LogBook IS

LogBook is a coexistence-friendly Claude Code plugin that documents the construction of a project. It captures decisions, errors, fixes, lessons, and resources as they happen — through hooks, MCP tool calls, and manual CLI capture — and renders them into deterministic markdown, ADRs in Nygard format, teaching scripts, and self-contained HTML you can hand to a class.

It is the pedagogical layer on top of the construction process. It is local-first, markdown-first, evidence-first.

## What LogBook IS NOT

LogBook deliberately does not reinvent existing tools. It is not:

- **An OpenTelemetry collector.** Claude Code emits OTel natively (sessions, tokens, cost, accept/reject). LogBook ingests it; it does not replace it.
- **An ADR tool by itself.** The Nygard ADR format is a published standard with tools like log4brains. LogBook generates Nygard-compliant ADRs but it is not the format authority.
- **A generic observability platform.** Langfuse, SigNoz, Braintrust, and Dynatrace own that surface. LogBook does not compete.

LogBook is the curated, didactic narrative on top — and a configurator for the Claude Code ecosystem that installs the artifacts needed to produce that narrative without breaking the rest of your `.claude/` setup.

## The data flow

```
   User <-> Claude Code (session)
              |
              v
       PostToolUse hook (compiled CJS bundle)
              |
              v
   +-------------------------+
   | Ingest pipeline         |
   |   - parse               |
   |   - normalize           |
   |   - redact (Gitleaks)   |
   |   - JSONL append        |
   |   - SQLite index (best-effort) |
   +-------------------------+
              |
              v
   +-------------------------+
   | MCP server (logbook-mcp) | <- agent calls 9 tools per Skill instructions
   +-------------------------+
              |
              v
   +-------------------------+
   | Generators              | <- deterministic; logbook build
   |   - index.md            |
   |   - timeline.md         |
   |   - errors-and-lessons.md |
   |   - ADRs (Nygard)       |
   |   - teaching-script.md (LLM) |
   +-------------------------+
              |
              v
   +-------------------------+
   | Exports                 |
   |   - export html         |
   |   - export instructor-pack |
   |   - export --safe (redacted) |
   +-------------------------+
```

Two important properties:

- **JSONL is the source of truth.** `logbook/evidence/events.jsonl` is canonical. SQLite (`.logbook/index.sqlite`) is a best-effort index, reconstructable from the JSONL at any time.
- **Generation is deterministic.** Running `logbook build` twice with no new events produces byte-identical output. The exception is the LLM-backed `teaching-script` generator, which is non-deterministic by design.

## Artifacts

An "artifact" is any file or file-fragment that LogBook installs into the project. There are eight kinds, locked in `src/types/artifact.ts`:

| Kind | What it does |
|------|--------------|
| `hook` | Entry in `.claude/settings.local.json` invoking the LogBook hook bundle on Claude Code events (`PostToolUse`, `SessionStart`). |
| `mcp_server` | Entry in `.mcp.json` registering `logbook-mcp` (stdio, project-scoped). |
| `slash_command` | Markdown file in `.claude/commands/lb-*.md` — `lb-decision`, `lb-error`, `lb-fix`, `lb-lesson`, `lb-milestone`, `lb-phase`, `lb-review`, `lb-status`. |
| `skill` | Two files under `.claude/skills/logbook-auto-capture/` — `SKILL.md` (fixed context) and `reference.md` (on-demand). |
| `subagent` | Markdown file under `.claude/subagents/` — `logbook-curator` and `logbook-teacher`. Teaching preset only. |
| `augment_claudemd` | Idempotent block inside the project's `CLAUDE.md`, delimited by `<!-- logbook:claudemd start --> ... <!-- logbook:claudemd end -->`. |
| `statusline` | `statusLine` key in `.claude/settings.local.json` invoking `logbook state --inline`. Teaching preset only. |
| `gitignore_entry` | Lines appended to `.gitignore` covering `.logbook/`, `logbook/`, and a tag comment. |

Every artifact is recorded in `.logbook/install-manifest.json` with an `lb-*` id, a content hash, an anchor describing how to locate it on uninstall, and the install timestamp. The manifest is the only authoritative record of what LogBook touched.

## Presets

A preset is a named bundle of artifacts. There are three; `full` is a forward-compatible alias for `teaching`.

| Preset | Manifest entries | Token budget |
|--------|------------------|--------------|
| `minimal` | 2 (hook + gitignore_entry) | 0 |
| `standard` | 14 (1 hook + 1 mcp + 1 augment + 8 slash + 2 skill files + 1 gitignore) | 381 |
| `teaching` | 18 (standard + 2 subagents + 1 statusline + 1 SessionStart hook) | 499 |

The build order is fixed and deterministic; see `src/core/presets.ts` for the authoritative sequence. Order matters for byte-identity: install applies it forward, uninstall applies it in reverse.

## Token budget

Spec §23 mandates a hard ceiling of 500 fixed-context tokens combined across all installed artifacts that go into the agent's context window. The breakdown is enforced by `logbook doctor --measure`, which is also a CI gate:

- `skill` — `SKILL.md` body (`reference.md` is loaded on demand, counted as 0).
- `augmentClaudemd` — body inside the augment markers (not including the marker lines themselves — those are not in the agent's view).
- `mcpToolDescriptions` — one-line description of each of the 9 MCP tools.
- `slashCommandDescriptions` — the `description:` field from each slash command's YAML frontmatter.
- `sessionStart` — conservative max of 120 tokens, per design §6/T8.D1.
- `subagentDescriptions`, `statusline` — 0 tokens (separate UI surfaces, not injected into the main agent context).

The 1-token margin in the teaching preset is intentional. New features must trim before they grow.

## Choosing an LLM provider

LogBook only uses an LLM for **four** commands: `summarize milestone`, `summarize project`, `teaching-script`, and `providers test`. Everything else (hooks, capture, build, export, etc.) runs without ever touching an LLM. So the "which provider" decision matters less than people assume — but here's the chooser if you need it.

### The auth resolution order (automatic, no config required)

When LogBook needs an LLM, it picks the first available path in this order:

```
1. Claude Code session active     → claude-agent-sdk (your subscription pays)
2. ANTHROPIC_API_KEY set          → @ai-sdk/anthropic (API credits)
3. OPENAI_API_KEY set             → @ai-sdk/openai (API credits)
4. nothing                        → LLM disabled, those 4 commands error gracefully
```

You can override this with `logbook providers set <target> <kind>` once installed. The auth check is in `src/llm/provider-router.ts:108-120` if you want to read the implementation.

### When to pick which

| Your situation | Recommended provider | Why |
|---|---|---|
| You work inside Claude Code daily (Pro or Max subscription) | **Default — do nothing**. The `claude-agent-sdk` path picks up automatically when you launch `logbook` from a Claude Code session. | Zero setup. No double-charging for tokens you already pay for through the subscription. |
| You want LogBook to work standalone, without Claude Code running, on a paid tier | `anthropic` (API key) or `openai` (API key) | Pay-as-you-go is fine for LogBook's volume (~50K-150K tokens/day). Privacy guaranteed by paid-tier T&Cs. |
| Zero cost, **non-sensitive content**, willing to set up an API key | `google` (Gemini API free tier) | Free tier exists. ⚠ **Privacy caveat below — read before using with student code or proprietary content.** |
| Zero cost, no internet for LLM, willing to run locally | `local` (Ollama) | Free, fully local on `localhost:11434`. Slower and lower-quality output than the cloud models. **Most private option.** |
| You have ChatGPT Plus + `codex` CLI installed | `codex-cli` | Subprocess to your local Codex CLI session. No API key, uses your subscription. Streaming not supported. |
| You have Azure OpenAI Enterprise | `azure` | Use your Azure deployment credentials. |

### Gemini API free tier — what you actually get

Verified at <https://ai.google.dev/gemini-api/docs/pricing> on **2026-05-18**:

- **Free tier exists** for these models (subject to change — check the page above for the current list): Gemini 3.1 Flash-Lite, Gemini 3 Flash Preview, Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash-Lite, Gemini 2.0 Flash, Gemini 2.0 Flash-Lite.
- **No credit card required** to get a free API key. Visit <https://aistudio.google.com/apikey>.
- **Specific RPM / RPD / TPM limits are not published on a static page anymore.** Google moved them to a user-specific dashboard. Check yours at <https://aistudio.google.com/rate-limit>. Free tier tends to be in the range of "low double-digit RPM, hundreds-to-low-thousands RPD" depending on model, which is far above LogBook's volume.
- ⚠ **CRITICAL — free tier content is used to train Google's models**. The pricing page states verbatim: *"Free Tier: Content used to improve our products — Yes"*. The paid tier explicitly says the opposite. This means: every prompt LogBook sends (which includes your project events, decisions, code snippets if `--with-diff`) can be used by Google to improve their models. Paid-tier API calls are not used for training.

**Implications for the instructor use case**:

- If you're using LogBook on a **public teaching project** or your **own teaching content** (no NDA, no student-attributable data), free tier is fine.
- If you're using LogBook on **student code, proprietary projects, or anything under NDA**, do NOT use the free Gemini tier. Use the Claude subscription path, paid Anthropic/OpenAI API, or `local` (Ollama).
- LogBook's `--safe` flag redacts paths/usernames/emails before send, but **does not redact code content or LLM prompts**. The privacy boundary is the provider, not the redaction layer.

### Cost reality check

For a normal instructor (5-10 LLM calls per day, ~100K tokens/day) — figures as of 2026-05-18:

- **Claude subscription** (Max $200/mo or Pro $20/mo): already paid, $0 additional. Subscription terms prevail.
- **Anthropic API** (Claude 3.5 Sonnet): ~$0.30 / day, ~$10 / month if used every weekday. Paid-tier privacy.
- **OpenAI API** (GPT-4o-mini): ~$0.05 / day. Paid-tier privacy.
- **Gemini API paid tier** (Gemini 2.5 Flash): ~$0.02 / day. Paid-tier privacy.
- **Gemini API free tier**: $0. ⚠ Content used for training.
- **Ollama local**: $0, slower, fully private (nothing leaves your machine).

For most users the right answer is: **use the Claude subscription you already have**, or **pay-as-you-go on Anthropic/OpenAI/Gemini paid tier** (cents per day). The free Gemini tier is fine only for non-sensitive content.

### Routing per task (advanced)

You can mix providers — for example, use Claude for `teaching-script` (high-quality structured output) and Gemini for `summarize milestone` (cheap and fast). Configure via:

```sh
logbook providers set task:teaching-script anthropic-claude-sdk --model claude-opus-4-6
logbook providers set task:summarize       google                 --model gemini-1.5-flash
```

The router resolves in this priority: `by_task[task] > by_phase[phase] > default_provider`. See [`03-cli-reference.md`](./03-cli-reference.md#logbook-providers-set) for the full grammar.

### What is NOT supported (and why)

- **ChatGPT Plus subscription as an API**. OpenAI does not expose the chat subscription programmatically. You need a separate API key from <https://platform.openai.com>. This is OpenAI's policy, not a LogBook limitation.
- **Gemini CLI subprocess**. Considered for v1.3 and rejected — see [`v1.3-roadmap.md`](./v1.3-roadmap.md#section-7--provider-strategy-decisions-added-2026-05-18-evening) §7.2. The `google` adapter (API direct) covers the same model with simpler setup and streaming support.

## Byte-identity contract

Spec §24.8 / §37 guarantee: install + uninstall leaves every shared file byte-identical to its pre-install state, even when other plugins have entries in `.claude/settings.local.json`, `CLAUDE.md`, `.mcp.json`, or `.gitignore`. This is enforced by:

- **Pure string-patching.** LogBook never does `JSON.parse` + `JSON.stringify` on shared files (that would normalize whitespace and collapse comments). All edits are surgical string operations via `src/util/json-string-patch.ts`. See [`05-architecture.md`](./05-architecture.md#string-patch-primitives) for the contract.
- **`_logbookId` tagging.** Every entry LogBook adds carries an `lb-*` id, either as a JSON field, a markdown block marker, or a manifest record (for scalar values where no in-situ tag is possible, the manifest stores a `contentHash`).
- **Backups.** Before any write, the original is copied to `.logbook/backups/<file>.pre-logbook` with a `sha256` recorded in the manifest. The `BackupRef` schema lives in `src/types/manifest.ts`.
- **End-to-end gate tests.** Six byte-identity e2e tests (`tests/e2e/byte-identity-*.test.ts`) run install → snapshot → uninstall → snapshot, then assert SHA-256 equality of every file outside `.logbook/` and `logbook/`.

## Idempotent markdown blocks

Generated markdown content lives strictly inside delimited blocks:

```md
<!-- logbook:generated start id="timeline" -->
... auto-generated content ...
<!-- logbook:generated end -->
```

`logbook build` only writes between markers. Anything outside the markers — your prose, your custom sections, your hand-edited examples — is preserved literally. There are four distinct marker families to avoid collisions:

- `logbook:claudemd` — the CLAUDE.md augment block (installer).
- `logbook:generated` — generic doc blocks (generators).
- `logbook:doc:*` — per-document blocks (generators, scoped IDs).
- `logbook:teaching-script` — teaching-script blocks (LLM generator).

If you delete a marker pair, that section is no longer auto-managed and `build` will skip it.

## Redaction

Before any captured value enters `events.jsonl`, it passes through `src/redact/`:

- **Gitleaks-derived regex rules** — vendored, roughly 30 high-signal patterns (AWS, Stripe, OpenAI, Anthropic, GitHub tokens, generic JWTs, private keys).
- **Shannon entropy filter** — strings of length ≥ 20 with entropy ≥ 3.5 are redacted.
- **Hash-shape filter** — prevents false positives on SHA-256-like inputs that are not secrets (added in iter1, slice S2.D5).

Matches are replaced with `[REDACTED:<type>]`. The same pipeline runs again at `logbook export --safe` time, which additionally redacts absolute paths, usernames, and emails (`src/export/safe.ts`).

The redaction guarantee is end-to-end: `tests/e2e/redaction-end-to-end.test.ts` asserts 9 cases — positive hits get redacted, negative cases pass through untouched.

## MCP tools vs CLI commands

LogBook exposes the same domain through two interfaces:

- **MCP tools** (9 of them): the agent calls them automatically when patterns match the Skill's triggers. Tool names are `logbook_decision`, `logbook_error`, `logbook_fix`, `logbook_lesson`, `logbook_resource`, `logbook_milestone`, `logbook_phase`, `logbook_suggest`, `logbook_state`. Each goes through the same dispatcher pipeline: rate-limit → payload size → valibot strict validation → path confinement (for path inputs) → redaction → audit event written **before** the side effect → handler.
- **CLI commands**: the human calls them — or scripts do — when you want to record something explicitly. `logbook decision`, `logbook error`, `logbook fix`, `logbook lesson`, `logbook resource`, `logbook milestone`, `logbook phase`, `logbook start`, `logbook snapshot`, `logbook visual`.

Both write to the same JSONL with the same canonical shape (top-level fields, per T10b.D1 unification in iter3). Generators read both indistinguishably.

The `logbook_suggest` MCP tool is special: it queues an item for human review (`pending-suggestions.jsonl`) rather than committing. The Skill is instructed to call it instead of `logbook_lesson`, because only humans author lessons.

---

Next: [`03-cli-reference.md`](./03-cli-reference.md) for the full command surface, or [`05-architecture.md`](./05-architecture.md) for the how-it-works deep dive.
