# 06 — Construction log

How LogBook itself was built. This is the pedagogical centerpiece of the documentation: if you want to replicate the methodology, the patterns, or the rhythm, read this file.

LogBook was constructed across 6 iterations using Spec-Driven Development with subagent delegation, strict TDD per slice, and Engram persistent memory across sessions. The full trail of every artifact (proposal, design, tasks, apply-progress, verify-report, archive-report per iteration) is in Engram.

## Methodology — SDD (Spec-Driven Development) with subagent delegation

Each iteration followed the SDD phase chain:

```
proposal -> specs --> tasks -> apply -> verify -> archive
             ^
             |
           design
```

Each phase had explicit read/write rules. A spec phase reads the proposal and writes a specification artifact. A tasks phase reads spec + design and writes a slice plan. An apply phase reads tasks + spec + design (and any prior apply-progress when continuing a batch) and writes an apply-progress artifact tracking which slices are done. A verify phase reads spec + tasks + apply-progress and writes a verify-report. An archive phase reads everything and writes a final archive-report.

Three properties made the methodology load-bearing:

1. **Strict TDD per slice.** Every slice followed the cycle: write a test that fails (RED) → write the implementation that makes it pass (GREEN) → refactor while keeping green. No "test after" commits. The verify phase re-ran the entire suite from scratch on independent context, distrusting the apply-progress at face value.

2. **Subagent delegation kept the main thread clean.** Each SDD phase was run as a subagent with a focused prompt. The orchestrator (the main conversation thread) coordinated; the executors did the work in fresh contexts. This is what made it possible to ship a project this size without context pollution.

3. **Engram persistent memory across sessions.** Every phase wrote its artifact to Engram with a stable topic key (`sdd/logbook-mvp-iter<N>/<phase>`). When a session ended and a new one began, the orchestrator searched Engram, retrieved the artifacts, and resumed without re-reading the full history.

The phase model assignments were:

| Phase | Model | Reason |
|-------|-------|--------|
| sdd-explore | Sonnet | Reads code, structural — not architectural. |
| sdd-propose | Opus | Architectural decisions. |
| sdd-spec | Sonnet | Structured writing. |
| sdd-design | Opus | Architecture decisions. |
| sdd-tasks | Sonnet | Mechanical breakdown. |
| sdd-apply | Sonnet | Implementation. |
| sdd-verify | Sonnet | Validation against spec. |
| sdd-archive | Haiku | Copy and close. |

## The six iterations

Each section below summarizes one iteration: its mission, slice count, key decisions, bugs the tests caught, and final cumulative state.

---

### Iter1 — Foundation (commit `e7bc29d`, 315 tests)

**Mission.** Spec §35 row 1: setup TypeScript + vitest, citty CLI with `init` / `status` / `doctor` / `disable` / `enable` / `uninstall` / `purge` / `ingest`, manifest from day one, redaction engine, hooks installer for the minimal preset, SQLite index reconstructable from JSONL, and — the gate — the byte-identical install/uninstall e2e test (§24.8, §37).

**Slices.** 10 (S1 foundation scaffolding, S2 redaction engine, S3 string-patch + markdown-block + line-set, S4 cold-start hook benchmark gate, S5 JSONL + SQLite store, S6a/b install engine, S7 hook + gitignore installers, S8 CLI surface, S9 ingest pipeline, S10 byte-identity harness).

**Key architectural decisions.**

- **Pure string-patching for shared files.** `src/util/json-string-patch.ts` (572 lines) is the load-bearing primitive. The decision: never call `JSON.parse` + `JSON.stringify` on `.claude/settings.local.json`, `CLAUDE.md`, `.claude/mcp.json`, or `.gitignore`. Every edit is a surgical string operation. This is what makes the §37 byte-identity contract possible.
- **JSONL as source of truth, SQLite as best-effort index.** SQLite native bindings can fail in unusual environments (CJS bundles, tmp dirs). The canonical event log is plain JSONL with file-locking (`proper-lockfile`) and `fdatasync`. SQLite is rebuilt from JSONL when needed.
- **Sentinel backups.** When backing up a shared file before install, an empty `sha256` records "file did not exist pre-install". On uninstall, sentinel-empty files are deleted rather than restored — keeping the project byte-identical to its pre-install state.

**Bugs the tests caught.**

Iter1 was foundation-only — no surprising bugs because there was nothing built yet. But two deviations were necessary mid-apply:

- **S2.D5 hash-shape filter.** The redaction engine initially flagged SHA-256 hashes of innocuous strings (like `sha256("hello")`) as secrets. Added the hash-shape filter to prevent false positives. Discovered by the negative test cases in `redaction-end-to-end.test.ts`.
- **S8.D2 install-engine rollback bug.** Early implementation didn't persist backups to the manifest before the install pass. If install failed mid-way and rollback fired, the rollback couldn't find the backup paths. Fixed by writing the `backups` array to the manifest as soon as `backupOnce` returns.

**Final state.** 315 tests (230 unit + 72 integration + 13 e2e). Both gates passed: S4 cold-start hook p95 = 29 ms, S10 byte-identity clean + with-fake-plugin both GREEN. Token budget: 0 for minimal preset (only hook + gitignore — no agent-context artifacts).

**Deviations carried.** CRLF behaviour mixed-newline on Windows (S3.D3) → resolved in iter2.

---

### Iter2 — MCP server + manual capture + standard preset (commit `77f6130`, 634 tests)

**Mission.** Spec §35 row 2: `start`, `phase`, `session rename`, `snapshot`, the 6 manual marker commands, `logbook-mcp` with its 9 tools, slash commands, CLAUDE.md augment block, the 3 deterministic generators (`index-doc`, `timeline-doc`, `errors-doc`), Nygard ADRs, HTML export, and the `<!-- logbook:generated -->` marker contract.

**Slices.** 15 (T1–T13 with T8 and T10 splits).

**Key architectural decisions.**

- **MCP SDK low-level `Server` + `setRequestHandler` instead of high-level `McpServer.registerTool`.** Rationale: `McpServer.registerTool` requires Zod. LogBook uses valibot everywhere else. Importing Zod just for the MCP tool registration was rejected — the low-level API gives the same protocol surface and lets valibot drive validation. Documented as T7.SDK in the iter2 deviations register.
- **`json_object_key` anchor variant.** Distinct from `json_field` (array-item semantics). Used by the MCP server installer because `.claude/mcp.json` adds a key under `mcpServers`, not an array element. T4.D1 in iter2.
- **CRLF normalization pipeline.** `src/util/crlf.ts` introduced. Every installer reads raw → `detectLineEnding()` → `toLF()` → string-patch → `fromLF(detected)` → write. The detected ending is recorded in the manifest for symmetric uninstall.

**Bugs the tests caught.**

- **Latent backup-not-persisted bug surfaced by T13 uninstall test.** Early in T13 (final integration of the standard preset), the e2e test installed 12 artifacts, uninstalled, and asserted byte-equality. A subset of files came back with different bytes. Root cause: the same install-engine rollback issue from iter1 S8.D2 re-emerged under a different code path — backups were not persisted during the multi-file install. Fixed by re-routing every installer's backup call through the persisted `backups` array in the manifest before the first write.

**Final state.** 634 tests (432 unit + 187 integration + 15 e2e). Both gates passed: byte-identity-standard + byte-identity-crlf. Token budget: 177 tokens fixed-context (augment 54 + MCP 68 + slash 55) — safely under the 500 ceiling with a 323-token margin for iter3 growth.

**Deviations carried.** Event shape divergence (CLI top-level vs MCP `payload`-nested) flagged as T10b.D1 MONITOR — generators normalized both at read time, but the divergence was scheduled for unification in iter3. CLI bundle grew from 366 KB to 706 KB after adding unified+remark+rehype — flagged T12.D3 for a split in iter3.

---

### Iter3 — Skill + LLM + Review TUI + teaching script (commit `5bf3544`, 816 tests)

**Mission.** Spec §35 row 3: Skill installer + body + reference, Vercel AI SDK + Claude Agent SDK integration, `providers list/set/test`, `summarize milestone/project`, `promote` for `teachingValue` tagging, the Ink-based `logbook review` TUI, and the LLM-backed `teaching-script` generator.

**Slices.** 13 (T1–T13).

**Key architectural decisions.**

- **Pure reducer + Ink render + persist bridge.** The review TUI was the first place this pattern landed. `src/review/flows.ts` is a pure reducer with no Ink imports — `initialState`, `reduce(state, action)`. All state transitions live there and are unit-tested without `ink-testing-library`. `src/review/tui.ts` is a thin Ink wrapper. `src/review/persist.ts` is the side-effect bridge. This pattern was reused for the iter6 unified shell.
- **LLM router is injectable.** `createRouter({ providersPath, mockAdapter?, sleep? })`. Tests inject a stub; CI sets `LOGBOOK_LLM_MOCK=1`. The CI guard (`assertNoLiveLLMInTests`) asserts zero real calls end-to-end.
- **Event-shape unification (closing iter2 MONITOR-1).** All 8 MCP handlers were migrated to write top-level event fields, matching the CLI shape. A `normalizeEvent` read-path normalizer kept iter2 events readable for backward compatibility.
- **tsup 4th entry split (closing iter2 MONITOR-2).** The unified/remark/rehype chain was extracted into `dist/export/html.cjs`, loaded lazily from `src/cli/commands/export/html.ts` via a non-literal `require()` path that esbuild cannot resolve at bundle time. CLI bundle dropped from 706 KB to 217 KB.
- **Skill installer reuses `owned_file` cleanly.** Two manifest entries per Skill (SKILL.md + reference.md), parent-directory create/cleanup symmetric. No new anchor variant needed.

**Bugs the tests caught.**

- **Iter3 was largely clean.** No production-bugs caught — the iter2 patterns were solid and the new code surface was test-driven from the start. The MCP description-sync gap was identified (no test asserted the byte-arrays of tool descriptions in `doctor.ts` matched the source text in each tool file) and scheduled for iter4 closure.

**Final state.** 816 tests (578 unit + 221 integration + 17 e2e + 2 skipped). Both gates passed: byte-identity-standard + byte-identity-skill. Token budget: 381 fixed-context (Skill 204 + augment 54 + MCP 68 + slash 55). MONITOR-1 and MONITOR-2 closed. MONITOR-3 (.gitattributes for CRLF fixtures) carried to iter4.

---

### Iter4 — Subagents + statusline + SessionStart + OTel/Codex (commit `ea5f649`, 1067 tests)

**Mission.** Spec §35 row 4: subagent installer + 2 subagents, statusline installer, SessionStart memory hook, OTel ingest connector, Codex ingest connector, `export --safe` redaction, teaching preset assembly, and closure of the 3 iter3 carry-forward warnings.

**Slices.** 13 (T1–T13) + 1 hotfix (T-FIX-HOOK).

This is the iteration where strict TDD paid off most clearly. Two real bugs were caught by tests before they shipped. Both would have silently corrupted user data in production.

**Key architectural decisions.**

- **SubagentInstaller and StatuslineInstaller reuse existing patterns.** Owned_file for subagents, json_field with `contentHash`-only id for statusline (scalar values have no in-situ tag slot). No new AnchorSpec variant needed.
- **SessionStart hook outputs to stdout.** Claude Code injects the hook's stdout into the agent context for the session. Conservative max budget = 120 tokens (= 480 chars). Used as the hard constant in `doctor --measure` to guarantee the worst case is visible to the budget gate.
- **Statusline command form.** Invokes `node <abs>/dist/cli/index.cjs state --inline` directly. `state --inline` reads `.logbook/state.json` synchronously and prints `<phase> | <session> | <pending>` — no SQLite, no network, ≤ 200 ms.
- **`full` is a forward-compatible alias for `teaching`.** Locks `init --preset full` for future use without breaking the present.

**The two real bugs caught by tests (the pedagogical gold)**

These are the cases worth understanding deeply if you want to internalize "tests drive design".

#### Bug 1 — HookInstaller controlled re-serialize regression (T-FIX-HOOK)

**Discovered by.** The iter4 e2e byte-identity test for the teaching preset (T12).

**Symptom.** Install the teaching preset (which adds both `PostToolUse` and `SessionStart` hooks) into a project that already has a `PostToolUse` hook from another plugin. Run uninstall. Take the byte diff against the pre-install snapshot. Some bytes differ.

**Root cause.** An earlier version of `HookInstaller` did a "controlled re-serialize" of the hooks key when it had to inject a new hook event (e.g., `SessionStart` when `PostToolUse` already existed). The re-serialize normalized whitespace inside the hooks object even when the existing pre-existing `PostToolUse` array was supposed to be untouched. Symmetric uninstall couldn't restore the original whitespace because the new whitespace was different bytes.

**Production impact if shipped.** Real projects with pre-existing PostToolUse hooks from other Claude Code plugins (gentle-ai, claude-code-hooks-mastery, awesome-claude-plugins, etc.) would have their `settings.local.json` whitespace silently modified by `logbook init --preset teaching`. Subsequent `logbook uninstall` would not restore byte-identity. The §37 promise would have been broken in a way that's invisible to a user without diff tooling.

**Fix.** T-FIX-HOOK rewrote the installer as a 3-step pure-string-patch algorithm (no JSON re-serialize at all):

```
Step 1: if hooks key absent, inject "hooks": {} via setJsonObjectKey (root).
Step 2: if hooks.<Event> array absent, inject "<Event>": [] via setJsonObjectKey (/hooks).
Step 3: insertIntoJsonArray to append the hook entry into the (now-present) array.
```

Uninstall reverses the steps symmetrically. The manifest records `createdHooksStructure` and `createdHookEvent` flags so the engine knows what to undo.

**Without iter4 T10/T11/T12 e2e byte-identity tests, the bug would have shipped.** This is the most important lesson in the codebase.

#### Bug 2 — `logbook providers set` wrote without backup (S3)

**Discovered by.** The iter3 carry-forward S3 audit during iter4 T9.

**Symptom.** Calling `logbook providers set task:teaching-script anthropic-claude-sdk --model ...` mutated `.logbook/providers.json` without first creating a backup. If the user had hand-edited `providers.json` (which is allowed) and the rename-write failed mid-way, the file could be left in a corrupt state with no recovery path.

**Root cause.** `src/cli/commands/providers/set.ts` was added in iter3 T7 alongside the other LLM provider commands. The other commands (`list`, `test`) are read-only and don't need backups; the `set` command was written from the read-only template and inherited the no-backup assumption.

**Fix.** Added a `backupOnce(paths.providersPath, ...)` call before the load-modify-save sequence in `src/cli/commands/providers/set.ts:124-129`. The backup is idempotent (taken once per file per install lifetime) and writes a sentinel when the file did not previously exist. Test assertion added in `cli-providers-set.test.ts`.

**Production impact if shipped.** Power users editing `providers.json` directly (a documented use case for setting up multi-task routing) could permanently lose their config if the next `logbook providers set` call failed mid-write.

**Final state.** 1067 tests (729 unit + 315 integration + 23 e2e + 2 skipped). All 3 iter4 gates passed (byte-identity-subagent, byte-identity-statusline, byte-identity-teaching). Token budget: **499 / 500** — the hard ceiling, with a 1-token margin. SessionStart contributes 120 (conservative max). All 3 iter3 carry warnings (W-MONITOR-3, S1, S3) closed.

**Deviations carried.** Partial `.gitattributes` coverage for statusline CRLF fixture (W1) — closed in iter5. Subagent fixtures LF pin missing (S1) — closed in iter5.

---

### Iter5 — instructor-pack + README + polish (commit `f133c9b`, 1118 tests)

**Mission.** The final deliverable shape: `logbook export instructor-pack` (self-contained HTML bundling docs + ADRs + teaching scripts with TOC + safe-mode + cross-doc link rewrite), the root `README.md` (≤ 5-minute read, all required sections), and closure of the iter4 carry-forwards.

**Slices.** 10 task slices + 1 README consolidation.

**Key architectural decisions.**

- **`exportInstructorPack` is 4 pure helpers.** `collectBundle` (gather files), `generateToc` (TOC from collected docs), `rewriteDocLinks` (normalize cross-doc references), and the orchestrator `exportInstructorPack` itself. Pure functions; testable in isolation. Lives in `src/export/instructor-pack.ts`.
- **Self-contained HTML.** Inlined CSS; zero external references (asserted by `src/export/sanitize-links.ts`). Same lazy-load pattern as `export html` — the unified/remark/rehype chain is in `dist/export/html.cjs`, loaded only when the subcommand runs.
- **README is the entry point.** All 7 required sections (What, Install, Quick start, Command reference, Token budget, Architecture, Uninstall). 6,651 chars (about 140 lines). Verified by `tests/integration/readme-presence.test.ts`.

**Bugs the tests caught.** Iter5 was the cleanup iteration. No production bugs surfaced. Two known limitations documented as warnings:

- **W2 — anchor navigation non-functional in instructor-pack HTML.** The `<a id="...">` tags used for TOC anchors are stripped by `rehype-stringify` when `allowDangerousHtml: false`. The TOC links render as hyperlinks but in-browser anchor navigation does not work. Post-MVP fix: add `rehype-slug` plugin.
- **W1 — `mcp-rate-limit.test.ts` timing variance.** A pre-existing flake from iter3. Passes in isolation, sometimes fails under heavy parallel load. Sleep is at 1300 ms since iter3. Post-MVP fix: add `retry: 2` or `concurrent: false` in vitest config.

**Final state.** 1118 tests (762 unit + 333 integration + 23 e2e + 2 skipped). All 24 §37 DoD items confirmed GREEN. Token budget: 499 / 500 (unchanged — instructor-pack is binary export, not agent context). CLI bundle: 251 KB; Export bundle: 344 KB; Total: 667 KB. MVP COMPLETE.

---

### Iter6 — Unified TUI shell (commit `353d2f9`, 1286 tests, post-MVP v1.1)

**Mission.** Add a unified TUI shell on top of the finalized MVP. Pure additive UX — no behavior changes to any existing command. Goals: zero-arg `logbook` opens an interactive dashboard; 4 screens (home, install wizard, configure, review bridge); pure reducer pattern (same as iter3); no token budget impact; no regression to any iter1–iter5 gate.

**Slices.** 6 (T1–T6), 28 sub-tasks total.

**Key architectural decisions.**

- **Pure refactors first (T1).** Extracted `src/core/presets.ts` and `src/core/token-measure.ts` from `init.ts` and `doctor.ts` respectively, with 19 regression snapshot tests asserting zero behavioral change. This made the new code testable in isolation without touching the iter1–iter5 surface.
- **Pure reducer + Ink render + persist bridge (T2–T5).** Mirrors iter3's review TUI exactly. 73 reducer unit tests covering all state transitions. The persist bridge has 7 action handlers (`runInstallAction`, `runBuildAction`, etc.) that the side-effect `useEffect` invokes when the reducer transitions to a "doing, promise=pending" state.
- **`React.createElement`, no JSX.** Zero tsup/tsconfig changes. Bundle remains a single CJS file.
- **ReviewApp as child component, not nested `render()`.** Iter6 mounts the iter3 review TUI as a React child within the shell's Ink tree, preserving breadcrumb + footer chrome. Nested `render()` would create terminal-control conflicts.
- **Zero-arg CLI intercept with TTY guard (T6).** `src/cli/index.ts:97-113`. If `process.argv.length === 2` AND both stdin and stdout are TTYs, dynamic-import the shell and run it. Otherwise (CI, pipes, scripts) fall through to citty's help. Dynamic import keeps Ink + React out of the cold-start bundle for all subcommand invocations.

**Bugs the tests caught.**

- **T5 Risk #1 — wizard preset propagation.** The install wizard's chosen preset wasn't being forwarded from the screen state to the action handler. Caught by the shell-actions test, which asserted that selecting `teaching` in the wizard resulted in `runInstallAction` being called with `{ preset: "teaching" }`. Fixed by routing wizard choices through `doing.opts` in the reducer.
- **T5 Risk #2 — barrel import cycle.** Importing the shell entrypoint from `src/cli/index.ts` triggered an Ink/React load at CLI cold-start time (before the TTY guard could skip it). Caught by the cold-start bundle-size regression test. Fixed by switching to a dynamic `import("../tui/shell.js")` inside `maybeShell()`.

**Final state.** 1286 tests (909 unit + 354 integration + 23 e2e + 2 skipped). All iter1–iter5 gates still GREEN; no regression. CLI bundle: 329 KB (under 400 KB gate). Token budget: unchanged (TUI is binary, not agent context).

---

### Iter7 — v1.1 release (feat/v1.1, 1501 tests, +215 from iter6)

**Mission.** Ship LogBook **v1.1** — expanding the MVP along four axes: multi-provider LLM expansion, pedagogical visual layer (Mermaid, ADR diffs, git SHA tagging), curation polish (animated TUI spinner, `rehype-slug` anchors, `--safe` on build), and PDF export + annotations.

**Slices.** 18 implementation slices across 7 slice groups (SG0, SG4, SG1a/b/c, SG3, SG2a/b/c, SG6, SG5), plus SG-GATE docs and CHANGELOG. Methodology: SDD explore → propose → spec → design → tasks → apply (12 batches) → verify → archive. Strict TDD per slice across all 18.

| Slice group | Slices | Key deliverable |
|-------------|--------|----------------|
| SG0 | 1 | Token budget margin: shorten MCP descriptions, add sync test |
| SG4 | 2 | S4.1 animated spinner; S4.2 clock-injected rate limiter |
| SG1a/b/c | 5 | Multi-provider: Gemini, Ollama, Codex CLI subprocess, Providers TUI, `--task` flag |
| SG3 | 3 | `rehype-slug`, `logbook build --safe`, `summarize --out` |
| SG2a/b/c | 4 | Git connector, `--with-diff` ADRs, CSS theming, Mermaid inline SVG |
| SG6 | 2 | `logbook annotate`, speaker-notes marker family |
| SG5 | 1 | `logbook export pdf` via `puppeteer-core` (optionalDependencies) |
| SG-GATE | — | CHANGELOG, README v1.1 sections, docs updates |

**Key architectural decisions.**

- **Mermaid placeholder tokens.** The initial approach (HTML comment placeholders) was swallowed by the unified/remark pipeline. Switched to bare-text `LBMERMAID_N` tokens that survive remark-parse → remark-rehype → rehype-stringify. The `rehype-raw` dependency was added then removed in the same iteration (commit 3148538) — avoiding it kept the export bundle from ballooning (675 KB → 361 KB).
- **PDF via `optionalDependencies`.** `puppeteer-core` declared as `optionalDependencies` (not `dependencies`) so that `pnpm install --no-optional` in the byte-identity CI job never installs Chrome. All PDF tests use `LOGBOOK_PUPPETEER_MOCK=1`. The pdf entry point uses `Function('p', 'return import(p)')` to defeat esbuild static analysis, keeping `pdf.cjs` at 4.25 KB with puppeteer-core externalized.
- **Git SHA session caching.** `state.json` gains `gitSha?` and `gitShaCapturedAt?`. `SessionStart` captures once (5ms subprocess); all subsequent hook events read from state (0ms). Manual commands (`snapshot`, `decision`, `milestone`) call `getGitSha()` fresh at invocation time. This kept hook p95 under 141ms despite the new field.
- **Codex CLI contract locked.** `stdin = prompt`, `stdout = JSON`, mock seam via `LOGBOOK_CODEX_MOCK=1`. The contract shape was locked before the apply phase; only the exact CLI flag names were verified at apply time (`exec --non-interactive --json`).

**Bugs caught by tests.**

- **`puppeteer-core.executablePath()` is async in v25+.** The initial `detectChromePath()` called it synchronously and got `ERR_INVALID_ARG_TYPE`. The test for the Chrome-detection failure case caught this before shipping.
- **`noExternal: [/.*/]` overrides explicit `external` in tsup.** When building `pdf.cjs`, using `noExternal` with a wildcard caused esbuild to follow `puppeteer-core` imports and bundle them — making the output 40 MB. Caught by the integration test asserting `pdf.cjs < 80 KB`. Fixed by removing `noExternal` from the PDF entry's tsup config.

**Final state.** 1501 passing tests (1309 unit + 167 integration + 25 e2e). All 18 slices: PASS. All 8 byte-identity gates: GREEN. Token budget: ≤495/500 (PASS). CLI bundle: 390.99 KB (PASS, 9 KB headroom). Hook p95: 141ms (PASS). PDF bundle: 4.25 KB (PASS). 5 bundles total.

**Post-release polish (commit `0d4f848`).** An animated TUI banner was added to the HomeScreen — 8-line mixed-case ANSI Shadow LogBook artwork with a 640 ms line-reveal animation, cyan-bold body + dim subtitle, version line that pulls from `package.json` via a named import (so esbuild tree-shakes the rest of the JSON out of the bundle). `.editorconfig` rule protects the load-bearing trailing whitespace on each banner line. 28 new tests covering geometry, version substitution, env-driven animation skip, and Ink rendering. The roadmap doc `docs/v1.1-roadmap.md` was cherry-picked from `feat/v1.1-roadmap` into main as historical record (commit `7212128`).

### Iter8 — v1.2 release (feat/v1.2, 1575 tests, +70 from v1.1.0 banner-touch + flake removal)

**Mission.** Ship LogBook **v1.2** — three focused in-tree improvements, no distribution work (deferred to v1.3 by user time-constraint decision).

**Slices.** 3 implementation slices via condensed SDD pipeline (design → apply × 3 → verify → archive). Strict TDD per slice.

| Slice | Deliverable |
|-------|-------------|
| SG-A | Streaming LLM via Vercel AI SDK `streamText`; new `onChunk?` callback through router/adapter/summarize; `--no-stream` CLI flag |
| SG-B | MCP clock injection via env var `LOGBOOK_MCP_CLOCK_OFFSET_MS` (TEST-ONLY); `parseMcpClockOffset` pure helper |
| SG-C | Doctor bundle soft warning at 380 KB threshold; `classifyBundle` + inline `BUNDLE_CAPS`; `--json` structured output |

**Key architectural decisions.**

- **Streaming as opt-in via callback.** Adding `streamText` could have been a separate adapter method; instead the adapter input gained an optional `onChunk?: (chunk: string) => void`. When the callback is present, the streaming path runs; when absent, the existing `generateText` path is unchanged. Zero signature break, full back-compat. The CLI computes the activation condition (`TTY && !--no-stream && NODE_ENV !== "test" && !--json`) and only passes `onChunk` when it should fire.
- **Byte-identity preservation under streaming.** Streaming writes tokens to stdout for UX, but the final file is written atomically once the stream completes — same code path as non-streaming. Tests assert byte-identical output across both modes. No risk of partially-written marker blocks.
- **Honest assessment of clock injection limits.** SG-B was advertised as "kills the mcp-rate-limit flake at the root". During verify it became clear the env var only shifts time at boot — the per-call timing race within the test still runs in real wall-clock. Two integration tests were **removed** (commit `310bb3a`) because they had the race; the rate-limit logic is covered deterministically by `tests/unit/rate-limit-clock.test.ts` from v1.1 SG-4. The remaining clock-offset integration tests (B7, B7b) only verify boot-time behavior, which is race-free.
- **Doctor as diagnostic, not gate.** SG-C's bundle measurement never causes doctor to exit non-zero. The hard cap is enforced by `tests/integration/cli-bundle-size.test.ts`, which runs in CI. The doctor command exists to surface drift early — and indeed it now fires its own soft warning on the CLI bundle (399.83 KB > 380 KB), validating the feature end-to-end.
- **Inline everything to stay under the cap.** The CLI bundle was at 391 KB pre-v1.2 with 9 KB headroom. SG-A added ~2.8 KB. SG-C had to fit in the remaining ~6 KB. Achieved by: inline `BUNDLE_CAPS` constant (no separate types file), ANSI codes hardcoded (no chalk/kleur dep), helpers as named exports in `doctor.ts` (a separate `doctor-bundle-helpers.ts` added ~76 bytes of unavoidable tsup module-wrapper overhead).

**Bugs caught by tests.**

- **`vi.spyOn` doesn't work on `node:child_process.spawn` under vitest ESM mode.** Discovered in SG-A streaming tests when verifying that the non-streaming path doesn't call `spawn`. Workaround: replaced spy-based assertions with timing assertions (`< 50ms === no I/O`), which is a sound behavioral proxy.
- **`NaN` from `parseInt(undefined)` in `parseMcpClockOffset`.** Initial implementation `Number(env["LOGBOOK_MCP_CLOCK_OFFSET_MS"])` returned `NaN` when the env var was unset. Unit test "returns 0 for NaN/garbage input" caught this immediately; final implementation uses an explicit `Number.isFinite` check with a 0 fallback.

**Final state.** 1575 passing tests (1309 + 167 + 25 + 74 new across SG-A/B/C and post-release banner work). All 8 byte-identity gates: GREEN. Token budget: 493/500 (unchanged from v1.1). CLI bundle: **399.83 KB** (PASS, but only 170 bytes headroom — v1.3 must refactor). MCP bundle: 44.46 KB. Other bundles unchanged. Tagged `v1.2.0`, squash-merged to main as commit `cf54c5c`.

**Deferred to v1.3.** Distribution via Homebrew tap + Scoop bucket; `logbook self-update`; update-check on startup; `SECURITY.md`; `docs/privacy.md`; CLI bundle refactor to reclaim headroom. The plan and required credentials are in [`docs/v1.3-roadmap.md`](./v1.3-roadmap.md).

---

## Test-driven discoveries — case studies

The HookInstaller re-serialize bug (Bug 1, iter4 T-FIX-HOOK) is the canonical example: a test caught a production-breaking bug that no review would have caught. Two more case studies follow.

### Case study 1 — Hash-shape filter in redaction (iter1 S2.D5)

**Symptom.** The redaction engine flagged `sha256("hello")` as a secret. This is a hash, not a token — but the entropy filter (≥ 3.5 entropy, ≥ 20 chars) does not distinguish.

**Discovery path.** Negative test cases in `tests/unit/redact-engine.test.ts` asserted that benign high-entropy strings (sha256 hashes, UUIDs, etc.) should pass through untouched. The test failed when the engine over-redacted.

**Lesson.** When you have a positive-case filter (entropy-based secret detection), you must also have negative-case tests (high-entropy non-secrets that should pass). The hash-shape filter (`64 hex chars + no other content`) is the kind of refinement that only exists because someone wrote a test that demanded it.

### Case study 2 — Install-engine rollback bug (iter1 S8.D2, re-emerged in iter2 T13)

**Symptom.** Multi-file install with a failure mid-way left orphan partial state. Subsequent uninstall couldn't restore byte-identity because the backups weren't recorded yet.

**Discovery path.** The iter1 §37 gate test (install → uninstall → byte-equal) failed when a fault was injected mid-install. The fix was structural: persist the `backups` array to the in-memory manifest the moment `backupOnce` returns, so rollback always has the backup paths.

**Lesson.** The §37 promise is not just about happy-path behaviour. The byte-identity gate must hold even when install fails partway. That requires the manifest to be transactional with respect to backups.

### Case study 3 — Wizard Enter "did nothing": the TDD coverage gap (2026-05-18, post-v1.2)

**Symptom.** First real user of the TUI launched `logbook` on a non-installed project. The wizard appeared at step 1. They pressed Enter on a preset and saw no visible change. Quote: *"al hacer enter o espacio no funciona bien y no se selecciona nada"*. All 1575 tests were green.

**Root cause.** The reducer's `select` action on the install screen set `choices.preset` but did NOT transition `step` to 2 (or reset the cursor). To advance, the user had to press Tab or `n` AFTER Enter — undocumented, unintuitive, no visual feedback that Enter had done anything because `renderOptionList` only marked the cursor position with `> `, not the chosen value with a checkmark.

**Discovery path.** The user reported the bug verbally; no test signal. Investigation:

- The 73 reducer tests in `tests/unit/shell-flows.test.ts` all asserted "after `select`, `state.screen.choices.preset === expected`". They passed BOTH for the correct (advance + save) and buggy (save-only) implementations because neither test cared what `state.screen.step` was.
- The 23 screen render tests in `tests/unit/tui-screens.test.ts` mounted `<InstallWizardScreen state={...} />` with fixture states and verified rendering. None simulated the keypress pipeline; they tested static rendering, not flow.
- No end-to-end test mounted the full `<ShellApp>` and pushed keystrokes through `ink-testing-library` to walk the wizard from step 1 to step 3.

**Fix.** Commit `67c98dc`: reducer `select` on install advances the step and resets cursor. `renderOptionList` now accepts a `chosen` arg and renders `✓ ` (green) for the chosen value separately from `> ` (cyan) for the cursor.

**Regression test added.** `tests/integration/tui-wizard-flow.test.ts` — 5 end-to-end tests using `ink-testing-library`:
1. Mounts at wizard step 1 when not installed.
2. **Enter on step 1 saves the preset AND advances to step 2** (the bug regression).
3. Enter on step 2 advances to step 3 with both choices preserved.
4. `j` moves the cursor (input capture sanity).
5. Cursor + Enter together picks the cursored option.

Test #2 in particular would have failed in CI on the day the bug was introduced.

**Lesson.** **State-mutation tests are not flow tests.** Per-action reducer tests guarantee "given action X, state moves to Y" but cannot guarantee that the user's sequence of actions (tied to keystrokes via a UI library) ends in a useful place. Per-component render tests verify presentation, not interaction.

**Convention going forward (TUI work).** Any new TUI feature that ships in a slice MUST include at least one test that:

1. Mounts the full `<ShellApp>` via `ink-testing-library`.
2. Writes the actual keypresses the user types (`\r` for Enter, `j`/`k` for navigation, `\t` for Tab, etc.).
3. Asserts on `instance.lastFrame()` — what the user SEES at each step, not what the state object contains.

Per-component and per-reducer tests remain valuable but MUST be paired with a flow test per user-visible feature. The TDD discipline was right; the test surface was incomplete.

## Architectural rhythm

Four patterns thread through every iteration. If you internalize these, you can replicate the methodology.

### Pure functions first; I/O last

Every load-bearing logic — reducers, the redaction engine, the event normalizer, the generators, the string-patch primitives — is a pure function. I/O lives in thin shells (CLI command handlers, persist bridges, MCP tool handlers). Unit-testable at high volume; integration tests cover the I/O glue.

The numerical evidence: 909 unit tests covering pure functions, 354 integration tests covering glue, 23 e2e tests covering the full pipeline. The pyramid is intentionally bottom-heavy.

### String-patch always; never re-serialize

This is the byte-identity contract throughline. The moment you call `JSON.stringify(JSON.parse(source))` on a shared file, you've broken the contract — whitespace normalizes, key order changes, the bytes drift. The discipline is to never reach for `JSON.parse + JSON.stringify` on `.claude/settings.local.json`, `.claude/mcp.json`, `CLAUDE.md`, or `.gitignore`. Every edit goes through `src/util/json-string-patch.ts`, `src/util/markdown-block.ts`, or `src/util/line-set.ts`.

The 6 byte-identity e2e gates are what enforce this discipline.

### Mock-first; real I/O in integration

LLM SDKs, MCP server, hook bundles all have mock-injectable APIs. The LLM router takes a `mockAdapter?` parameter; CI sets `LOGBOOK_LLM_MOCK=1` and the router uses the stub. The MCP server can be spawned in-process for integration tests. The hook bundle is built and spawned as a child process for the cold-start p95 test.

This is what made zero real LLM calls in CI verifiable. `getLiveCallCount() === 0` is asserted by `llm-no-real-calls.test.ts`.

### Subagent delegation — the main thread orchestrates; the work happens in fresh contexts

The methodology rule: the orchestrator delegates. The orchestrator does not implement. Each SDD phase ran as a focused subagent prompt, in a fresh context, with explicit read/write rules. The main conversation thread never accumulated the entirety of the codebase — it accumulated only the artifact summaries returned by each phase.

This is the only way to ship a project this size without context pollution. The Engram persistent memory layer is what made the orchestrator's coordinator role tenable across sessions: an artifact written by an iter1 subagent could be retrieved by an iter4 subagent verbatim.

## Reading the Engram trail

Every SDD artifact for every iteration is persisted in Engram. The topic keys follow the pattern `sdd/logbook-mvp-iter<N>/<phase>`. The full set:

| Topic key family | Content |
|------------------|---------|
| `sdd/logbook-mvp-iter1/proposal` … `archive-report` | Foundation iteration (6 phases). |
| `sdd/logbook-mvp-iter2/proposal` … `archive-report` | MCP + capture iteration. |
| `sdd/logbook-mvp-iter3/proposal` … `archive-report` | Skill + LLM iteration. |
| `sdd/logbook-mvp-iter4/design` … `archive-report` | Teaching preset iteration. |
| `sdd/logbook-mvp-iter5/explore` … `archive-report` | Instructor-pack + README. |
| `sdd/logbook-mvp-iter6/design` … `archive-report` | TUI shell iteration. |
| `sdd/logbook-v1.1/proposal` … `apply-progress` | v1.1 release — 18 slices, multi-provider + PDF + annotations. |

To retrieve any artifact, use `mem_search(query: "<topic-key>")` then `mem_get_observation(id: <id>)`. The full apply-progress for each iteration is particularly instructive — it records the RED → GREEN → REFACTOR cycle slice by slice.

This is the trail. If you want to replicate the methodology on your own project, run `/sdd-init` in your repository, then `/sdd-new <change-name>` for your first iteration. The phase chain will produce the same kind of artifacts.

---

Next: [`07-troubleshooting.md`](./07-troubleshooting.md) for the top-10 gotchas, or back to [`README.md`](./README.md).
