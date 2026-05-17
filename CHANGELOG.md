# Changelog

All notable changes to LogBook are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

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
