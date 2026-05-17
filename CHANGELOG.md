# Changelog

All notable changes to LogBook are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [1.2.0] — 2026-05-18

### Added

- **Streaming LLM responses** in `logbook summarize milestone` / `logbook summarize project`
  - Uses Vercel AI SDK `streamText` under the hood (`src/llm/vercel-sdk.ts`)
  - Tokens appear in real-time on the terminal as the model generates them
  - Activation: stdout is a TTY, `--no-stream` flag absent, and `NODE_ENV !== "test"`
  - Final file write remains atomic and byte-identical to the non-streaming path
  - New `--no-stream` flag forces non-streaming mode (useful when piping)
  - Mock adapter chunks its canned response when `onChunk` is provided (back-compat preserved)
- **Bundle size soft warning** in `logbook doctor`
  - Reports each bundle's status as ok / warn / fail / not_built
  - Soft thresholds: 380 KB for caps ≥ 200 KB; 95% of cap for smaller bundles
  - Color-coded human output (cyan/yellow/red ANSI); structured `--json` output for scripts
  - Honors `NO_COLOR` env per CLI convention
  - Diagnostic only — doctor never fails on over-cap (exit code unchanged)
- **Animated TUI banner** in the HomeScreen
  - Mixed-case ANSI Shadow LogBook artwork, cyan-bold body + dim subtitle
  - Version line reads from `package.json` at build time via named import (esbuild tree-shakes the rest of the JSON)
  - Line-reveal animation (80 ms × 8 lines = 640 ms total)
  - Auto-skips animation when `NODE_ENV=test` or `LOGBOOK_NO_ANIMATION=1`
  - Frozen via inline snapshot test + `.editorconfig` rule (trailing whitespace preserved)
- **Historical record**: `docs/v1.1-roadmap.md` cherry-picked from `feat/v1.1-roadmap` into main

### Changed

- **MCP server clock injection** via new env var `LOGBOOK_MCP_CLOCK_OFFSET_MS` (TEST-ONLY)
  - Server reads the integer offset at boot and wires it into `SlidingWindowLimiter` clock
  - Production behavior unchanged when env unset (offset = 0)
  - Stderr WARN emitted on boot if offset ≠ 0, never appears in user docs
  - New pure helper `parseMcpClockOffset(env)` exported for unit testing

### Removed

- Two integration tests with wall-clock race conditions (`mcp-rate-limit.test.ts`)
  - The "20 rapid calls; 21st → -32000" test had a ~40% false-failure rate on macOS ARM
  - The `LOGBOOK_MCP_CLOCK_OFFSET_MS` env var doesn't actually solve the per-call timing race (offset is applied at boot but the test's rapid calls still run in real wall-clock time)
  - Rate-limit logic is covered deterministically by `tests/unit/rate-limit-clock.test.ts` (v1.1) using an injected clock

### Performance

- CLI bundle: 390.99 KB → **399.83 KB** (cap 400 KB, ~170 bytes margin)
  - The SG-C soft-warning threshold (380 KB) is now firing on the CLI bundle itself — validating the feature
  - Headroom is tight; a CLI-bundle refactor is the first v1.3 slice
- MCP bundle: 43.91 KB → 44.46 KB (cap 100 KB)
- Hook bundle: 29.10 KB (unchanged)
- Export/html bundle: 364.51 KB (unchanged)
- Export/pdf bundle: 4.25 KB (unchanged)
- Hook p95: < 141 ms (cap 200 ms — unchanged)

### Tests

- 1505 → **1575 passing tests** (+70 net after removing 2 flaky integration tests)
- All 8 byte-identity e2e gates remain green
- Token budget unchanged at 493/500

## [1.1.0] — 2026-05-17

### Added

- Multi-provider LLM support
  - Google Gemini adapter via `@ai-sdk/google` (`kind: "google"`)
  - Ollama local adapter via `@ai-sdk/openai` with custom baseURL (`kind: "local"`)
  - Codex CLI subprocess adapter (`kind: "codex-cli"`, `src/llm/codex-cli.ts`)
  - TUI Providers screen with list / detail / routing / add flows
  - `logbook providers test --task <name>` flag for task-targeted testing
- Pedagogical visual layer
  - Mermaid diagram rendering in HTML exports (`@mermaid-js/mermaid-cli` devDep; build-time SVG inlining; sanitized via new `sanitizeSvg`)
  - `logbook decision --with-diff` captures git SHA + file diff stats into "## Implementation (commit <sha>)" section in ADRs
  - Git connector `src/connectors/git.ts` with `getGitSha`, `getRemoteUrl`, `buildCommitLink` (GitHub / GitLab / Bitbucket detection)
  - Auto-captured `event.gitSha` field on manual events
  - `logbook build` generates `logbook/docs/commits.md` cross-index
  - `--theme <path.css>` flag on `logbook export html` and `logbook export instructor-pack` with `sanitizeCss` for injection defense
- Polish & UX
  - Animated braille spinner in TUI DoingScreen
  - `rehype-slug` for working TOC anchor navigation in HTML exports (closes iter5 W2)
  - `logbook build --safe` flag (sanitization parity with export)
  - `--out <path>` flag honored on `summarize milestone/project`
- Annotations & speaker notes
  - `logbook annotate <event-id> --note "..."` CLI command with `manual.annotation` event type
  - `<!-- logbook:speaker start --> ... <!-- end -->` marker family for speaker notes
  - `--speaker-mode` flag on `logbook export html` and `logbook export instructor-pack`
- PDF export
  - `logbook export pdf` subcommand via `puppeteer-core` (optionalDependencies; fail-fast UX when Chrome unavailable)
  - Flags: `--out`, `--safe`, `--theme`

### Changed

- MCP tool descriptions for `logbook_lesson` and `logbook_state` shortened to create defensive token budget margin (499 → 493/500)
- `SlidingWindowLimiter` accepts injectable `clock` for deterministic testing (removed 1300ms sleep in rate-limit tests)

### Fixed

- Mermaid placeholder pattern survives the unified pipeline (switched from HTML comments to bare-text `LBMERMAID_N` tokens; avoided rehype-raw + parse5 dependency to keep export bundle under 400 KB)

### Performance

- CLI bundle: 329 KB → 391 KB (within 400 KB cap, 9 KB margin)
- Export bundle: 345 KB → 365 KB (within 400 KB cap)
- New PDF bundle: 4.25 KB (puppeteer-core externalized)
- Hook p95: <141ms (under 200ms gate)

### Tests

- 1286 → 1501 passing tests (+215 covering v1.1 surface)
- All 8 byte-identity e2e gates remain green
- Token budget hard-gate test passes

## [1.0.0] — 2026-05-16

Initial MVP release (iter1 through iter6). See `docs/06-construction-log.md` for full construction history.
