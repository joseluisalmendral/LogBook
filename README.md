<pre>
 ▌  ██╗                     ██████╗                 ██╗     
 ▌  ██║                     ██╔══██╗                ██║     
 ▌  ██║      █████╗  █████╗ ██████╔╝ █████╗  █████╗ ██║ ██╗ 
 ▌  ██║     ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗█████╔╝ 
 ▌  ███████╗╚█████╔╝╚██████║██████╔╝╚█████╔╝╚█████╔╝██╔═██╗ 
 ▌  ╚══════╝ ╚════╝  ╚═══██║╚═════╝  ╚════╝  ╚════╝ ╚═╝ ╚═╝ 
 ▌                   █████╔╝                                
 ▌  ──────────────────────────────────  captain's log · v1.2.0
</pre>

# LogBook

A local CLI that documents AI-built projects via Claude Code hooks, MCP tools, and pedagogical exports.

> The banner above is the actual TUI header — run `logbook` (zero-arg, on a TTY) to see it animated. The version line below the dashes updates automatically with each release.

LogBook captures decisions, errors, fixes, lessons, and resources as they happen — automatically through Claude Code hooks and MCP tool calls, or manually via CLI commands. It renders them into deterministic markdown, Nygard ADRs, LLM-backed teaching scripts, and self-contained HTML you can hand to a class.

## Status

**v1.3.0** — 1882 tests green / 80 skipped. **Lean 2-hook install** (slice 26), **transcript-first capture** with auto-recovery of historical sessions, **editorial HTML export** (Paper Brutalism design system, slice 28–30) with zen mode, teaching/path-blur, scroll-driven wow. Not yet published to npm or Homebrew — install via local clone + `pnpm link --global`. See [`docs/01-getting-started.md`](./docs/01-getting-started.md).

## TL;DR — 5 minutos para tu primer export

```sh
# UNA VEZ (a nivel sistema)
git clone https://github.com/joseluisalmendral/LogBook.git
cd LogBook
pnpm install && pnpm build
pnpm link --global
which logbook                            # confirma que está en tu PATH

# EN CADA PROYECTO donde quieras LogBook
cd /path/to/your-project
logbook init --yes                       # registra 2 hooks ligeros + MCP

# (opcional) reiniciá Claude Code para que tome los hooks
# trabajá normalmente con Claude Code — la captura es PASSIVE (no tenés que hacer nada)

# Cuando quieras ver el resultado
logbook build                            # backfillea todo desde el transcript de Claude Code
logbook export html --out salida.html    # genera el HTML editorial interactivo
open salida.html
```

> **¿Ya tenés sesiones de Claude Code hechas en este repo antes de instalar LogBook?**
> **Salen igual.** `logbook build` enumera todas las sesiones que Claude Code grabó en `~/.claude/projects/` para este repo y las backfillea desde el transcript. No perdés nada de tu trabajo previo.

## Cómo funciona

LogBook captura cada sesión de Claude Code automáticamente — vos no hacés nada durante la conversación. Cuando querés ver el resultado, generás un HTML editorial autocontenido con todas tus sesiones replayables.

Slice 26 simplificó la captura a **2 hooks**:
- `SessionStart` — inyecta contexto cross-session a Claude al arrancar
- `Stop` — dispara el transcript scraper al final de cada turno

El **scraper** lee el transcript que Claude Code persiste en `~/.claude/projects/<encoded>/<sessionId>.jsonl` (siempre presente, antes de cualquier hook) y backfillea: user prompts, mensajes de Claude, sub-agents, tool calls, files touched, agent questions, skills. Idempotente por hash + tool_use_id.

**Red de seguridad final:** si en algún momento un hook falló o cerraste Claude rápido, `logbook build` siempre recupera todo desde el transcript. No hay forma de "perder" datos.

## Install detallado

```sh
git clone https://github.com/joseluisalmendral/LogBook.git
cd LogBook
pnpm install && pnpm build
pnpm link --global
```

Si `pnpm link --global` falla con `ERR_PNPM_NO_GLOBAL_BIN_DIR`, corré `pnpm setup` primero (one-time por máquina). Detalle en [`docs/07-troubleshooting.md`](./docs/07-troubleshooting.md#1a-err_pnpm_no_global_bin_dir-when-running-pnpm-link---global).

Tres presets:

| Preset | Hooks | Token budget | Cuándo |
|---|---|---|---|
| `minimal` | 2 (SessionStart + Stop) | 0 | Quiero solo capture + export, nada más |
| `standard` (default) | 2 (lean post slice 26) | ~380 | Captura + MCP + slash commands + skill |
| `teaching` | 2 + statusline + 2 subagents | ~499 | Stack pedagógico completo |

## El flujo que vas a usar 99% del tiempo

```sh
# Hoy
cd mi-proyecto
logbook init --yes              # primera vez en este repo
# trabajá con Claude Code normalmente

# Mañana, después de unas sesiones
logbook build                   # backfillea desde transcripts (recoge todo lo nuevo)
logbook export html             # → logbook/exports/index.html

# Si querés un path específico para compartir
logbook export html --out ~/Desktop/curso-clase-3.html

# Si vas a presentar en público y no querés mostrar paths locales
logbook export html --safe --out ~/Desktop/curso-clase-3.html
# (o activá Teaching mode en el sidebar del HTML — más flexible)
```

## El export HTML — qué tiene

El HTML generado (single file, no external refs) abre la conversación completa como una experiencia editorial:

- **TOC editorial** con tus sesiones como lista numerada, cursor spotlight en hero
- **Burbujas de chat** con tu prompt a la derecha (acento violeta) y Claude a la izquierda (acento ember + sparkle Anthropic)
- **Sub-agents** desplegables con prompt, response, tools, files touched
- **Agent questions** con tus elecciones marcadas
- **Tool calls expandibles** con comando exacto + output preview
- **Teaching mode** — toggle que blurea paths absolutos para presentar en clase
- **Zen mode** — oculta sidebar/scrubber, tipografía grande, ideal para proyectar
- **Theme light/dark** con toggle

Estilo: **Paper Brutalism** — editorial cream paper + Inkwell Violet + Claude Ember + Teal Basin. Doc de referencia del sistema completo en `/Users/joseluis.fernandez/Documents/ALMENDRAL.IA/PROYECTOS PERSONALES/MANUAL_DISENO_WEB_MODERNO.md`.

### LLM providers

| Provider | Kind | Auth |
|----------|------|------|
| Anthropic (Claude) | `anthropic` | `ANTHROPIC_API_KEY` or Claude Code session |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Azure OpenAI | `azure` | `OPENAI_API_KEY` + `base_url` |
| Google Gemini | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Ollama (local) | `local` | None — requires `ollama serve` on `:11434` |
| Codex CLI | `codex-cli` | Configured in the `codex` binary |

Configure a provider:

```sh
logbook providers set task:teaching-script gemini-default --model gemini-2.0-flash
logbook providers test --task teaching-script --json
```

### PDF export

The dedicated `logbook export pdf` command was removed in slice 19 (the legacy
multi-page shell it depended on was deleted). To produce a PDF, open the new
interactive HTML (`logbook export html`) in any browser and use its print-to-PDF
feature.

### Annotations and speaker notes

```sh
# Annotate any captured event:
logbook annotate <event-id> --note "This decision was pivotal because..."

# Export HTML with speaker notes rendered:
logbook export html --speaker-mode
```

Speaker note blocks use the `<!-- logbook:speaker start --> ... <!-- logbook:speaker end -->` marker family.

## Command reference

Full reference with all flags and examples: [`docs/03-cli-reference.md`](./docs/03-cli-reference.md).

Quick reference:

| Command | What it does |
|---------|--------------|
| `logbook init [--preset minimal\|standard\|teaching]` | Install LogBook artifacts (default: `standard`) |
| `logbook build [--safe]` | Regenerate `logbook/docs/*` from events |
| `logbook decision --title "..." --chosen "..."` | Record an architectural decision (ADR) |
| `logbook decision --with-diff` | Record ADR + capture git SHA + diff stats |
| `logbook annotate <event-id> --note "..."` | Add a note to any captured event |
| `logbook export html [--safe] [--speaker-mode] [--no-transcripts]` | Self-contained interactive HTML (single file) |
| `logbook providers list` | List configured LLM providers |
| `logbook providers set <target> <provider>` | Configure routing |
| `logbook providers test [--task <name>]` | Validate provider round-trip |
| `logbook summarize milestone [--out <path>] [--no-stream]` | LLM summary (streams to TTY by default in v1.2+) |
| `logbook review` | TUI for curating pending suggestions |
| `logbook doctor [--measure]` | Diagnose install health; measure token budget + bundle sizes |
| `logbook uninstall [--force]` | Remove all artifacts (data preserved) |

## Token budget

LogBook enforces a hard ceiling of **500 fixed-context tokens** for all installed artifacts. The teaching preset sits at 499/500. CI blocks any change that exceeds 500.

```sh
logbook doctor --measure --json
```

Fields in the breakdown: `skill`, `augmentClaudemd`, `mcpToolDescriptions`, `slashCommandDescriptions`, `sessionStart`. All sum to `fixedContextTokens`. See [`docs/02-concepts.md`](./docs/02-concepts.md#token-budget) for the full model.

## Documentation

Everything lives under [`docs/`](./docs/):

- [`docs/01-getting-started.md`](./docs/01-getting-started.md) — install, your first 5 minutes, preset choice, LLM setup, gotchas
- [`docs/02-concepts.md`](./docs/02-concepts.md) — the conceptual model
- [`docs/03-cli-reference.md`](./docs/03-cli-reference.md) — every command with flags and examples
- [`docs/04-flows-by-role.md`](./docs/04-flows-by-role.md) — flows for developers, instructors, and students
- [`docs/05-architecture.md`](./docs/05-architecture.md) — internals for maintainers
- [`docs/06-construction-log.md`](./docs/06-construction-log.md) — how LogBook itself was built (7 SDD iterations, methodology, bug case studies)
- [`docs/07-troubleshooting.md`](./docs/07-troubleshooting.md) — top gotchas with fixes
- [`CHANGELOG.md`](./CHANGELOG.md) — version history

Canonical product spec: [`logbook_mvp_spec_v3.md`](./logbook_mvp_spec_v3.md).

## Architecture in 6 bullets

- **Local-first.** All data lives in the project. No server. No upload except explicit LLM calls.
- **Transcript-first capture.** The Claude Code transcript at `~/.claude/projects/<encoded>/<sid>.jsonl` is the source of truth. Slice 26 made the scraper authoritative for `user_prompt`, `claude_message`, `tool_use`/`tool_result`, `subagent_complete`, `skill_invoked`, `agent_question`. Hooks are scaffolding (SessionStart for context inject, Stop as scraper trigger).
- **JSONL is the persisted format.** `logbook/evidence/events.jsonl` is canonical; SQLite is a best-effort index, reconstructable from the JSONL.
- **Byte-identical install/uninstall.** Every shared file (`CLAUDE.md`, `.claude/settings.local.json`, `.claude/mcp.json`, `.gitignore`) is edited via pure string-patching. Uninstall restores the original bytes exactly. Enforced by 4 e2e gate tests (`byte-identity-{clean,crlf,with-fake-plugin,with-fake-plugin}`).
- **500-token ceiling for fixed agent context.** `logbook doctor --measure` enforces it; teaching preset sits at ~499/500. CI blocks any change that pushes it over.
- **Deterministic generation.** `logbook build` reads JSONL and writes markdown inside idempotent `<!-- logbook:generated -->` blocks. Content outside markers is preserved literally. Plus: enumerates all sessions in `~/.claude/projects/` and backfills via the scraper before generating — recovers historical work automatically.

## Uninstall

```sh
logbook uninstall --force         # removes artifacts; data stays in logbook/ and .logbook/
logbook purge --force             # full deletion (logbook/ + .logbook/)
```

`uninstall` restores every shared file to its pre-install bytes — byte-identically. Other plugins in `.claude/` are unaffected.

## License

ISC
