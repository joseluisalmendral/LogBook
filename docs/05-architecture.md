# 05 — Architecture

For developers maintaining or extending LogBook. This document maps the codebase, explains the load-bearing invariants, and traces the pipelines that make the byte-identity contract possible.

## Directory map

```
src/
├── cli/                          # citty entry + subcommand files
│   ├── index.ts                  # main + zero-arg shell intercept
│   └── commands/                 # one file per subcommand (init, doctor, build, …)
│       ├── annotate.ts           # logbook annotate <event-id> --note (v1.1)
│       └── export/
│           └── pdf.ts            # logbook export pdf via puppeteer-core (v1.1)
├── connectors/
│   ├── claude-code/
│   │   ├── hook.ts               # 22-line PostToolUse / SessionStart hot path
│   │   ├── ingest.ts             # stdin → normalize → redact → JSONL append
│   │   └── artifacts/            # 8 installers (one per artifact kind)
│   ├── codex/                    # Codex ingest normalizer
│   └── git.ts                    # getGitSha + getRemoteUrl + buildCommitLink (v1.1)
├── core/                         # install engine, manifest, paths, presets, token budget
│   ├── install-engine.ts         # 13-step orchestrator + reverse rollback
│   ├── uninstall-engine.ts       # symmetric reverse pass
│   ├── presets.ts                # buildMinimal/Standard/TeachingArtifacts
│   ├── token-measure.ts          # computeTokenBreakdown (doctor --measure)
│   ├── manifest.ts               # install-manifest.json CRUD
│   ├── backup.ts                 # backupOnce (sentinel + sha256)
│   ├── detect.ts                 # plugin fingerprint detection
│   └── state.ts                  # .logbook/state.json (gitSha?, gitShaCapturedAt? in v1.1)
├── export/                       # HTML + instructor-pack + safe-mode + PDF
│   ├── mermaid.ts                # Mermaid fence → inline SVG pipeline (v1.1)
│   ├── pdf.ts                    # exportPdf + detectChromePath (v1.1, puppeteer-core)
│   └── safe.ts                   # sanitizeForSafeExport + sanitizeSvg + sanitizeCss (v1.1)
├── generate/                     # deterministic generators
│   ├── adr.ts                    # Nygard ADR writer (--with-diff support in v1.1)
│   ├── index-doc.ts              # logbook/docs/index.md
│   ├── timeline-doc.ts           # logbook/docs/timeline.md
│   ├── errors-doc.ts             # logbook/docs/errors-and-lessons.md
│   ├── commits-doc.ts            # logbook/docs/commits.md cross-index (v1.1)
│   ├── speaker-blocks.ts         # speaker-note marker family (v1.1)
│   ├── teaching-script-doc.ts    # logbook/teaching-scripts/* (LLM-backed)
│   └── blocks.ts                 # marker family management
├── hooks/
│   └── session-start.ts          # ≤120-token summary writer
├── llm/                          # provider router + adapters
│   ├── provider-router.ts        # tasks > phase > default cascade
│   ├── claude-sdk.ts             # @anthropic-ai/claude-agent-sdk
│   ├── vercel-sdk.ts             # ai + @ai-sdk/anthropic + google + openai-compat (v1.1)
│   ├── codex-cli.ts              # Codex CLI subprocess adapter (v1.1)
│   ├── guards.ts                 # assertNoLiveLLMInTests
│   ├── redact-before-send.ts     # pre-flight scrub
│   └── summarize.ts              # high-level summarize entry (outPath support in v1.1)
├── mcp/                          # logbook-mcp server
│   ├── server.ts                 # SDK low-level Server + dispatcher
│   ├── audit.ts                  # writeAuditEvent (before-effect contract)
│   ├── rate-limit.ts             # SlidingWindowLimiter with injectable clock (v1.1)
│   ├── redact.ts                 # redactDeep for tool inputs
│   ├── context.ts                # bootstrap MCPContext (db, paths, state)
│   └── tools/                    # 9 tool files + index.ts barrel
├── normalize/                    # event normalizers (Claude / Codex / OTel)
├── otel/                         # OTLP-JSON ingest pipeline
├── redact/                       # Gitleaks + entropy engine
├── review/                       # pure reducer + Ink TUI
│   ├── flows.ts                  # initialState + reduce (Ink-free)
│   ├── tui.ts                    # Ink shell
│   └── persist.ts                # side-effect bridge
├── store/                        # JSONL append + SQLite index
├── tui/                          # unified shell (5 screens in v1.1)
│   ├── shell.ts                  # Ink ShellApp + runShell()
│   ├── shell-flows.ts            # pure reducer
│   ├── persist.ts                # buildSnapshot + action handlers
│   ├── screens/                  # home, install-wizard, configure, review-bridge, doing, providers (v1.1)
│   │   └── providers.ts          # ProvidersScreen list/detail/routing/add flows (v1.1)
│   └── components/               # breadcrumb, footer, token-budget-bar, modal-confirm
├── types/                        # event, decision, error, lesson, manifest, providers, …
└── util/                         # json-string-patch, crlf, markdown-block, hash, ulid, …

assets/                           # bundled templates (not inlined at build time)
├── slash/lb-*.md                 # 8 slash command bodies
├── skill/SKILL.md + reference.md
├── subagents/logbook-curator.md + logbook-teacher.md
└── claudemd/augment.md

tests/
├── unit/                         # ~120 files / 1309 tests (v1.1)
├── integration/                  # ~40 files / 167 tests (v1.1)
├── e2e/                          # 9 files / 25 tests (incl. 8 byte-identity gates)
└── fixtures/                     # other-plugin fixtures for coexistence tests
```

## Install engine — 13-step flow

`src/core/install-engine.ts` implements the engine. Algorithm:

1. **Resolve installers from registry** for every artifact in the input list.
2. **Run `detect()` per artifact** to build a `DiscoveryReport` (`will-install` | `skip-already-present` | `coexist-append` | `blocked`).
3. **Scan for known plugin fingerprints** in `.claude/settings.local.json` (`_gentleAiId`, `_lbId`, `_agentId`). Recorded as warnings; never blocks.
4. **Check `disableAllHooks`** flag globally. Recorded as a warning if true.
5. **Deliver the report via `onReport()`** so callers can render the plan.
6. **If `dryRun`** → return immediately, no disk writes.
7. **Backup phase.** `backupOnce(filePath)` for every file that will be modified. Sentinel backup (empty sha256) records "file did not exist pre-install" so uninstall can delete it cleanly.
8. **Install pass.** Walk the artifact list in input order; each installer's `install()` writes its anchor + content and registers a `ManifestArtifact`.
9. **On failure, reverse rollback.** Already-installed artifacts have `uninstall()` called in reverse; restored backups; manifest discarded.
10. **Flush manifest atomically** (temp-file + rename).

`runUninstall` is the symmetric counterpart: read manifest, run `uninstall()` per artifact in reverse, restore backups, delete sentinel-empty files, drop the manifest when fully drained.

## AnchorSpec union

`src/types/manifest.ts` defines five anchor shapes, each tailored to a target file format:

| Variant | When used | Example |
|---------|-----------|---------|
| `json_field` | Array-item insertions in JSON (e.g. a hook entry inside `$.hooks.PostToolUse`). Carries `jsonPath` + `idField` + `idValue`, plus optional flags for created structure. | `HookInstaller` |
| `json_object_key` | Object-key insertions in JSON (e.g. `$.mcpServers.logbook-mcp`). Includes `createdMcpServersKey` and `createdFile` for symmetric uninstall. | `MCPServerInstaller` |
| `markdown_block` | Content between `<!-- logbook:* start -->` and `<!-- logbook:* end -->` markers. Tracks `createdFile` + `addedLeadingNewline` for byte-identical uninstall. | `ClaudeMdAugmentInstaller` |
| `line_set` | Plain-text line appends (e.g. `.gitignore`). Records exact `lines` and the `addedLeadingNewline` / `trailingNewlineAdded` flags. | `GitignoreInstaller` |
| `owned_file` | The entire file is the artifact. `expected_sha256` of the bytes we wrote. On uninstall: refuse to delete if hash differs. | `SlashInstaller`, `SkillInstaller`, `SubagentInstaller` |

`StatuslineInstaller` is a `json_field` variant with `idField = ""` and `idValue = ""` — identification is content-hash-only, because a scalar JSON value has nowhere to embed an `_logbookId` tag.

## String-patch primitives

`src/util/json-string-patch.ts` (572 lines) is the load-bearing module for byte-identity. The contract:

> LogBook never calls `JSON.parse` + `JSON.stringify` on shared files.

Reason: `JSON.stringify` normalizes whitespace, drops comments (which JSON does not have but JSONC variants do), and rewrites key order. The result is a "valid" file that is byte-different from the input. That breaks the §37 promise.

Instead, every edit is a surgical string operation:

- `insertIntoJsonArray(source, jsonPath, item)` — finds the array at `jsonPath`, inserts `item` as a new element, preserves all surrounding whitespace.
- `removeFromJsonArray(source, jsonPath)` — symmetric inverse.
- `setJsonObjectKey(source, jsonPath, key, value)` — inserts a key into an object.
- `removeJsonObjectKey(source, jsonPath, key)` — symmetric inverse.

These work on the raw source string. They tolerate mixed indentation, tabs, CRLF, unusual key ordering. Tested against fixtures with all of the above.

The hook installer (`src/connectors/claude-code/artifacts/hook.ts:1-26`) describes the 3-step algorithm explicitly:

```
Step 1: if hooks key absent, inject "hooks": {} via setJsonObjectKey (root).
Step 2: if hooks.<Event> array absent, inject "<Event>": [] via setJsonObjectKey (/hooks).
Step 3: insertIntoJsonArray to append the hook entry into the (now-present) array.
```

Uninstall reverses in the symmetric order, and the manifest records `createdHooksStructure` / `createdHookEvent` flags so the engine knows what to undo.

## CRLF normalization

`src/util/crlf.ts` exposes `detectLineEnding`, `toLF`, `fromLF`. The pipeline for any file touched by an installer:

1. Read raw bytes.
2. `detectLineEnding()` → `"lf" | "crlf" | "mixed"`.
3. `toLF()` so all string-patch operations work on `\n` only.
4. Apply the patch.
5. `fromLF(detectedEnding)` to restore the original line endings.

The detected ending is recorded in `ManifestArtifact.detectedLineEnding` so uninstall replays it. This closure (iter2 W1 → resolved in iter2 T1+T3 retro-touch; iter4 added subagent + statusline CRLF fixture coverage) is what lets the byte-identity tests pass on both Unix and Windows CI.

`.gitattributes` pins prevent git's `core.autocrlf` from re-rewriting the CRLF fixture files at checkout time.

## Manifest format

`.logbook/install-manifest.json` schema (`src/types/manifest.ts`):

```ts
interface Manifest {
  version: 1;                              // bumped on breaking schema changes
  installed_at: string;                    // RFC3339 UTC
  preset: "minimal" | "standard" | "full" | "teaching";
  artifacts: ManifestArtifact[];
  backups: BackupRef[];
}

interface ManifestArtifact {
  id: string;                              // lb-* tag
  kind: ArtifactKindName;                  // 8-variant discriminator
  file_path: string;                       // project-relative
  anchor: AnchorSpec;                      // 5-variant union
  content_hash: string;                    // sha256
  installed_at: string;
  detectedLineEnding?: "lf" | "crlf" | "mixed";
  createdParentDirs?: string[];            // for owned-file installers
  preset?: "minimal" | "standard" | "full" | "teaching";
}

interface BackupRef {
  file_path: string;
  backup_path: string;                     // .logbook/backups/<file>.pre-logbook
  sha256: string;                          // "" sentinel = file did not exist
  taken_at: string;
}
```

The manifest is the only authoritative record of what LogBook touched. Uninstall reads it; doctor verifies against it; status renders it.

## MCP server architecture

`src/mcp/server.ts` uses the **low-level `Server` + `setRequestHandler`** API from `@modelcontextprotocol/sdk@1.29.0`, not the high-level `McpServer.registerTool`.

Reason: `McpServer.registerTool` requires Zod schemas. LogBook uses valibot throughout (smaller, no class hierarchy, identical type-inference ergonomics). Forking the validation layer was deemed unnecessary; the low-level API allows valibot for input validation.

The dispatcher pipeline runs for every tool call:

1. **Rate-limit gate** → `-32000 rate_limited` if > 20 calls/sec/tool (`src/mcp/rate-limit.ts` — sliding window).
2. **Payload size pre-check** → `-32002 payload_too_large` if raw JSON > 8192 bytes.
3. **Valibot strict validation** → `-32600 invalid_input` (rejects unknown fields per §31).
4. **Path confinement** → `-32001 path_escape` (only for tools with `pathFields`).
5. **Redact deeply** → secrets replaced via `redactDeep`; `didRedact` flag captured.
6. **Audit BEFORE effect** → `writeAuditEvent()` writes `mcp.tool_call` to `events.jsonl` with full args. If the process dies after audit but before the handler, the audit trail exists for forensics.
7. **Handler call** → domain writes (JSONL + SQLite + optional files like ADRs).
8. **Map throws** → JSON-RPC error envelopes. The process never crashes.

The 9 tools are wired in `src/mcp/tools/index.ts` as `ALL_TOOLS`. Each defines its own `valibotSchema` (used for validation) and `inputSchema` (advertised to MCP clients as plain JSON Schema for protocol-level documentation).

Stdio transport only. No HTTP, no WebSocket, no outbound network. Project-scoped registration in `.mcp.json` (never user-level). All confirmed by `src/mcp/server.ts:1-36` header comment.

## LLM router

`src/llm/provider-router.ts` (~360 lines). Design properties:

- **Injectable.** `createRouter({ providersPath, mockAdapter?, sleep? })`. Tests inject a stub adapter; CI sets `LOGBOOK_LLM_MOCK=1` so the router never makes a real call.
- **Cascade resolution.** Routing lookup: `tasks > phase > default`. Defined in `.logbook/providers.json`.
- **Redact-before-send.** Every prompt passes through `src/llm/redact-before-send.ts` first.
- **Retry policy.** 3 attempts with exponential backoff.
- **Fail-soft.** No auth available → returns `{ ok: false, error: { code: "no_auth", ... } }` instead of throwing. The caller decides whether to error or skip.
- **Auth resolution order.** `@anthropic-ai/claude-agent-sdk` (subscription session) > `ANTHROPIC_API_KEY` env var > `OPENAI_API_KEY` env var > disabled.

The CI guard (`src/llm/guards.ts:assertNoLiveLLMInTests`) fires if any real LLM call escapes the test boundary. `llm-no-real-calls.test.ts` asserts `getLiveCallCount() === 0` end-to-end.

## Review TUI pattern

`src/review/` was the first place this pattern landed (iter3) and `src/tui/` extends it (iter6).

**Three layers, strictly separated:**

1. **Pure reducer (`flows.ts`)** — `initialState` + `reduce(state, action)`. Ink-free, React-free, no I/O. All state transitions live here. Tested with vanilla unit tests (40 cases in iter3, 73 in iter6).
2. **Ink render (`tui.ts` / `shell.ts`)** — thin wrapper. `useReducer(reduce, initialState)`, `useInput` mapping keypresses to actions, `useEffect` watching screen kind for side-effect dispatch.
3. **Side-effect bridge (`persist.ts`)** — when the reducer transitions to a "doing, promise=pending" state, the bridge picks up the action label and routes to an action handler (`runInstallAction`, `runBuildAction`, etc.). Handlers are injectable so tests can stub them.

This separation is why the TUI is testable without `ink-testing-library` coupling. The reducer covers all state behaviour; smoke tests verify the Ink render renders something; persist handlers are tested in isolation.

## TUI shell extension

`src/tui/shell.ts` (iter6) follows the same pattern with 5 screens:

- `HomeScreen` — dashboard with menu.
- `InstallWizardScreen` — 3-step guided install (preset → provider → confirm).
- `ConfigureScreen` — settings menu.
- `ProvidersScreen` (v1.1) — provider management (list / detail / routing / add).
- `ReviewBridgeScreen` — mounts the existing iter3 `ReviewApp` as a child component, preserving the shell's chrome (breadcrumb + footer).
- `DoingScreen` — in-flight overlay during long-running actions.

Adding a new screen: extend the `ShellScreen` discriminated union in `src/tui/types.ts`, add the reducer transitions in `shell-flows.ts`, write the Ink component under `src/tui/screens/`, register in the `renderScreen` switch in `shell.ts`. TypeScript's exhaustiveness check on the switch catches missing screens at compile time.

The `ReviewApp.onExit` prop was added non-breakingly in iter6 (`src/review/tui.ts`) so the shell can be notified when review finishes. Iter3 callers that don't pass `onExit` continue to work.

### Banner module (v1.2)

`src/tui/banner.ts` holds the 8-line mixed-case ANSI Shadow LogBook artwork as a frozen `BANNER_LINES` tuple. Trailing whitespace on every line is **load-bearing** (column alignment for the `g` descender on row 7); `.editorconfig` sets `trim_trailing_whitespace = false` for this file, and an inline snapshot test catches any accidental mutation.

Version substitution uses a **named import** of `package.json`:

```typescript
import { version as PKG_VERSION } from "../../package.json";
```

The named import lets esbuild tree-shake everything except the `version` string out of the bundle (default import would inline the full package.json — ~5 KB hit).

`src/tui/components/banner.ts` is the Ink component. Renders cyan-bold body + dim subtitle. Animation: `setInterval(80ms)` × 8 lines = 640 ms total, one `setState` per tick, proper `useEffect` cleanup on unmount or completion. Auto-skips when `NODE_ENV=test` or `LOGBOOK_NO_ANIMATION=1`.

## LLM streaming pipeline (v1.2)

`src/llm/vercel-sdk.ts` exposes two parallel code paths: `generateText` (non-streaming) and `streamText` (streaming). The selection happens at adapter level: if the caller passes an `onChunk?: (chunk: string) => void` callback through `LlmProviderCallInput`, the streaming path is used; otherwise the original non-streaming path runs (back-compat preserved).

The flow:

1. `src/cli/commands/summarize/{milestone,project}.ts` decides whether streaming is active. Conditions: stdout is a TTY, `--no-stream` flag absent, `NODE_ENV !== "test"`, `--json` not set.
2. If active, the CLI builds an `onChunk` that writes each delta directly to `process.stdout`.
3. `src/llm/summarize.ts` accepts the callback in `SummarizeOptions` and threads it through `provider-router.ts` → adapter.
4. The adapter calls `streamText` (Vercel AI SDK), iterates `textStream`, accumulates chunks in memory AND invokes `onChunk(chunk)`.
5. After the stream completes, the full text is returned to `summarize.ts`, which writes it atomically to disk via the existing block-upsert path. **Bytes on disk are identical to the non-streaming path**.

The mock adapter (`src/llm/mock.ts`) splits its canned response into multiple chunks when `onChunk` is present so streaming tests don't need a live LLM.

## MCP clock injection (v1.2)

`src/mcp/server.ts` exports a pure helper `parseMcpClockOffset(env: NodeJS.ProcessEnv): number` that reads the **test-only** env var `LOGBOOK_MCP_CLOCK_OFFSET_MS` and returns an integer (defaulting to 0 on NaN / unset).

At server boot, the offset is wired into the `SlidingWindowLimiter` constructor via `clock: () => Date.now() + offset`. Production behavior is unchanged when the env var is unset (offset = 0). If offset is non-zero, the server emits a single stderr WARN line at boot.

The env var is **never** documented in user-facing materials. It is exclusively for deterministic integration tests of the server's boot behavior. (The per-call rate-limit timing race was NOT fixable via this offset — that's covered by unit tests with an injected clock in `tests/unit/rate-limit-clock.test.ts` from v1.1 SG-4.)

## Doctor bundle measurement (v1.2)

`src/cli/commands/doctor.ts` exports `classifyBundle(actualBytes, capBytes)` returning `"ok" | "warn" | "fail" | "not_built"`. Soft threshold formula:

```
soft = cap >= 200 KB ? cap - 20 KB : floor(cap × 0.95)
```

`BUNDLE_CAPS` is inlined as a constant. ANSI codes are inlined as string literals (no chalk dep). `--json` returns a structured array of bundle entries. The doctor command **never fails on over-cap** — this is a diagnostic, not a gate. The hard gate lives in `tests/integration/cli-bundle-size.test.ts`.

## Token budget enforcement

`src/core/token-measure.ts:computeTokenBreakdown(manifest, projectRoot)` returns the breakdown shown by `doctor --measure`. The heuristic is **`chars / 4`** for body content, with three constants baked in:

- `SESSION_START_CONSERVATIVE_MAX_TOKENS = 120` — the SessionStart hook prints a summary ≤ 480 chars, so we use 120 as the worst-case hard constant.
- `SUBAGENT_DESCRIPTION_TOKENS = 0` — subagent bodies surface in Claude Code's subagent index (a separate UI), not in the main agent context. Locked decision T8.D1.
- `STATUSLINE_TOKENS = 0` — UI element rendered in the status bar.

CI gate: `tests/integration/doctor-measure-teaching.test.ts` asserts `fixedContextTokens ≤ 500` for the teaching preset. Breaking the gate blocks the PR.

If Claude Code 2026 changes subagent injection semantics, update the constant and rerun the gate test.

## Test pyramid

The shape is intentionally bottom-heavy.

| Layer | Files | Tests | Speed | Purpose |
|-------|-------|-------|-------|---------|
| Unit | ~120 | 1309 | ~1.5 s | Pure functions: reducers, redactor, normalizers, generators, string-patch primitives, new v1.1 adapters. |
| Integration | ~40 | 167 | ~5 s | CLI commands invoked via in-process modules; installers; MCP boot; review flows; LLM router with mocks. |
| E2E | 9 | 25 | ~3 s | Built CJS bundles spawned as child processes. The 8 byte-identity gates live here. |

v1.1 adds 215 tests net across 18 implementation slices (SG0 + S4.1/S4.2 + S1.1–S1.5 + S3.1–S3.3 + S2.1–S2.4 + S6.1–S6.2 + S5.1). All slices follow strict TDD (RED → GREEN → REFACTOR).

Run them individually:

```sh
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test          # all three
pnpm typecheck     # tsc --noEmit
```

The `pretest:e2e` hook runs `pnpm build` first so e2e always tests the compiled bundles.

The 6 byte-identity gates (`tests/e2e/byte-identity-*.test.ts`) — clean, with-fake-plugin (§37), CRLF, skill, subagent, statusline, teaching — are the load-bearing protection for the §37 promise. Each one: install → directory snapshot (SHA-256 per file, excluding `.logbook/` and `logbook/`) → uninstall → directory snapshot → assert byte-equality.

## Cold-start budget

The CLI bundle (`dist/cli/index.cjs`) lazy-loads:

- The Ink/React TUI (`src/tui/shell.ts`) — dynamic `import()` only when zero-arg + TTY.
- The unified/remark/rehype HTML pipeline — non-literal `require()` path so esbuild cannot inline it. Lives in the separate `dist/export/html.cjs` bundle (iter3 MONITOR-2 closure).
- The MCP server lives in a separate `dist/mcp/server.cjs` bundle, launched by Claude Code as a child process.

The hook bundle (`dist/connectors/claude-code/hook.cjs`) is 28 KB — small enough that its cold-start p95 is 44–49 ms on Darwin ARM, well under the 200 ms budget. Tested by `tests/e2e/ingest-p95.test.ts`.

---

Next: [`06-construction-log.md`](./06-construction-log.md) for how this architecture was built, slice by slice, over 6 SDD iterations.
