# LogBook MVP — Especificación v3

## Propósito del documento

Versión 3 de la especificación de LogBook. Documento canónico de producto y técnica. El prompt de arranque para Claude Code vive en `KICKOFF_PROMPT.md` (artefacto separado, se elimina una vez completada la iteración 1).

---

# 1. Contexto del producto

Trabajamos en formación tech y creamos proyectos completos usando IA, desde la toma de decisiones de arquitectura hasta el despliegue.

El problema actual es que muchas veces el proyecto se enseña cuando ya está construido. Se pierde el proceso real: qué decisiones se tomaron y por qué, qué errores aparecieron y cómo se resolvieron, qué prompts fueron importantes, qué subagentes participaron, qué recursos se consultaron, cuánto tiempo llevó cada fase y qué parte hizo la IA frente a qué validó el humano.

LogBook convierte ese proceso en documentación clara, trazable y enseñable.

---

# 2. Visión

LogBook es un CLI local que acompaña la construcción de un proyecto con IA y genera una carpeta profesional con la historia del proceso.

> Mientras construyes con IA, LogBook transforma el proceso real en una historia enseñable con decisiones, errores, soluciones, subagentes, recursos y evidencias — apoyándose en estándares existentes, optimizando el coste en tokens y conviviendo con otros plugins de tu agente.

---

# 3. Filosofía y posicionamiento

LogBook **NO** es: un colector OpenTelemetry (Claude Code ya emite OTel nativo), un gestor de ADR desde cero (existe el formato Nygard y log4brains), una plataforma de observabilidad (existen Langfuse, SigNoz, Braintrust, Dynatrace).

LogBook **SÍ** es: la capa pedagógica encima — curación humana, narrativa didáctica, export profesional para clase, y vinculación de evidencia con momentos didácticos. Y además un **configurador del ecosistema Claude Code** (al estilo gentle-ai pero limitado a su misión) que instala los artefactos necesarios y los desinstala limpiamente.

---

# 4. Principios de diseño

1. **KISS** — primera versión simple, local, robusta.
2. **Local first** — todo vive en el proyecto, no requiere servidor.
3. **Markdown first** — salida principal en Markdown.
4. **Evidencia antes que narrativa** — IA puede resumir, pero los hechos son sesiones, archivos, commits y notas.
5. **Narrativa didáctica** — no un log técnico, un material enseñable.
6. **Intervención humana mínima pero curación obligatoria** — el usuario revisa y aprueba en hitos.
7. **Reversibilidad total** — todo lo que se instala se puede desinstalar limpio.
8. **Compatibilidad estándar** — OTel-genai, Nygard, formatos abiertos.
9. **Economía de tokens** — cada artefacto que va al contexto del agente está diseñado para ocupar lo mínimo. Detalle en §23.
10. **Coexistencia** — todo lo que se añade a archivos compartidos (`.claude/settings.local.json`, `CLAUDE.md`, `.gitignore`) se hace append-only y etiquetado. Detalle en §24.

---

# 5. Resultado esperado

```text
project/
  logbook/
    index.md
    timeline.md
    decisions/                  # ADRs Nygard
      0001-usar-nextjs.md
    errors-and-lessons.md
    prompts.md
    resources.md
    metrics.md
    teaching-script.md
    sessions/
      claude-code/
        session-abc123.md
    assets/
      screenshots/  clips/  diagrams/  traces/
    evidence/
      events.jsonl              # source of truth
      otel/
      sessions.json
      tool-calls.json
      git.json
      urls.json
      raw-notes/
    exports/
      logbook.html  logbook.pdf  instructor-pack.html  instructor-pack.pdf

  .logbook/
    config.json
    providers.json
    state.json
    install-manifest.json
    index.sqlite                # índice derivado, reconstruible
    AGENT_NOTES.md              # contexto extendido para el agente (cargado bajo demanda)
    pending-suggestions.jsonl   # sugerencias del agente esperando review
    backups/

  .claude/
    settings.local.json         # con hooks de LogBook etiquetados
    commands/
      lb-decision.md  lb-error.md  lb-fix.md  lb-lesson.md
      lb-milestone.md  lb-review.md  lb-status.md  lb-phase.md
    skills/
      logbook-auto-capture/
        SKILL.md                # corto y conciso
        reference.md            # detalle bajo demanda
    subagents/
      logbook-curator.md
      logbook-teacher.md
    mcp.json                    # registra logbook-mcp
    CLAUDE.md                   # con bloque LogBook delimitado
```

---

# 6. Alcance del MVP

1. `logbook init` con sistema de presets
2. Instalación quirúrgica de hooks y demás artefactos en `.claude/`
3. Exportación OTel nativa de Claude Code hacia un colector local
4. Servidor MCP `logbook-mcp` con tools para decisión/error/fix/lesson/resource/milestone/query
5. Slash commands, Skill, statusline, augment de CLAUDE.md
6. Subagentes `logbook-curator` y `logbook-teacher`
7. Memoria persistente entre sesiones (inyectada en SessionStart)
8. JSONL como fuente de verdad, SQLite como índice
9. `logbook review` TUI para curación
10. Generación Markdown determinista con marcadores idempotentes
11. ADRs en formato Nygard
12. Export HTML desde la iteración 2
13. **Desinstalación limpia** vía manifiesto con `--dry-run` obligatorio
14. **`logbook doctor`** con detección de plugins conocidos y conflictos

---

# 7. Fuera de alcance del MVP

Dashboard cloud, login multi-usuario, sincronización, extensión de navegador, grabación continua de pantalla, RAG sobre histórico, editor visual, subida automática a terceros, permisos avanzados, multi-proyecto centralizado.

---

# 8. Usuarios

**Instructor creador.** Construye con IA y quiere conservar el proceso. Necesita fricción mínima, marcado rápido, curación en hitos, resultado profesional.

**Instructor colaborador.** No construyó, tiene que enseñar. Necesita entender qué se construyó, recorrido completo, qué mostrar en clase, evidencia.

**Alumno final.** No usa LogBook directamente. Se beneficia del razonamiento real, no solo del resultado.

---

# 9. Historia de usuario principal

Como instructor que crea proyectos tech con IA, quiero que LogBook capture automáticamente el proceso, me deje marcar momentos importantes con la mínima fricción (slash commands, Skill, MCP), me obligue a una breve curación en cada milestone, y genere un material profesional para mi equipo. Quiero también que no rompa la configuración de mis otros plugins de Claude Code y que pueda desinstalarlo limpiamente.

Criterios de aceptación principales:

1. `logbook init --preset minimal` instala solo hooks + CLI, dejando intacto todo lo demás del `.claude/`
2. `logbook init --preset standard` añade MCP + slash + Skill + statusline + augment CLAUDE.md
3. `logbook init --preset teaching` añade subagentes y memoria persistente
4. Si ya hay hooks o entradas de otros plugins en `.claude/settings.local.json`, LogBook los respeta y solo añade los suyos
5. `logbook uninstall` deja `.claude/` exactamente como estaba antes
6. Cada artefacto añadido lleva un id `lb-*` localizable
7. Token cost de los artefactos cargados en el contexto del agente está documentado y minimizado
8. `logbook doctor` detecta conflictos conocidos con plugins populares

---

# 10. CLI completa

```bash
# Ciclo de vida
logbook init [--preset minimal|standard|teaching|custom] [--dry-run]
logbook doctor                        # estado, conflictos, salud
logbook status                        # fase, sesión, pendientes
logbook disable                       # silencia sin tocar archivos
logbook enable
logbook uninstall [--dry-run]         # revierte artefactos, conserva datos
logbook purge --force                 # uninstall + borra logbook/ y .logbook/

# Proyecto
logbook start "Nombre"
logbook phase <name>
logbook session rename <id> "Nombre"

# Captura automática (invocada por hooks o MCP, no por humanos)
logbook ingest claude
logbook ingest codex

# Marcadores manuales (también disponibles como slash commands y MCP tools)
logbook decision "..." [--alt "..."] [--why "..."]
logbook error "..."
logbook fix "..." [--error <id>]
logbook lesson "..."
logbook resource <url> "..."
logbook visual <path> "..." [--auto]
logbook milestone "..." [--next <phase>]
logbook snapshot

# Curación
logbook review                        # TUI Ink
logbook promote <event-id> --teaching high

# Generación y export
logbook build
logbook summarize milestone <id|last>
logbook summarize project
logbook export html|pdf|instructor-pack [--safe]

# Multi-proveedor
logbook providers list|set|test

# Artefactos (administración fina)
logbook artifacts list                # qué tiene instalado
logbook artifacts add <kind>          # añadir uno suelto
logbook artifacts remove <kind>       # quitar uno sin uninstall completo
```

---

# 11. Fases internas

`discovery, requirements, architecture, planning, implementation, validation, debugging, deployment, retrospective`.

Cambio: `logbook phase <name>`. Si lleva mucho tiempo sin cambiar, `logbook status` y la memoria persistente lo recuerdan.

---

# 12. Arquitectura de integración con Claude Code (capas)

LogBook se integra con Claude Code en cinco capas, en orden de preferencia:

| Capa | Para qué sirve | Coste tokens | Ubicación |
| --- | --- | --- | --- |
| 1. **MCP server** `logbook-mcp` | El agente **habla** con LogBook (crear decisión, consultar estado). Interfaz primaria. | Bajo (tools se cargan una vez) | proceso local |
| 2. **Hooks** en `settings.local.json` | Red de seguridad: capturar lo que el agente **hizo** sin pasar por MCP | 0 (no van al contexto) | `.claude/settings.local.json` |
| 3. **OTel nativo** de Claude Code | Métricas, sesiones, tokens, coste, accept/reject | 0 (telemetría aparte) | env vars + colector local |
| 4. **Skill + augment CLAUDE.md** | Instruir al agente sobre **cuándo** usar las capas anteriores | Bajo (carga progresiva) | `.claude/skills/` y `CLAUDE.md` |
| 5. **Slash commands + statusline + subagentes** | Atajos de **usuario** | 0–medio (solo al invocar) | `.claude/commands/` etc. |

**Principio rector:** lo que ya hace gratis OTel o los hooks, no se pide al agente. Lo que requiere intención semántica del agente, se hace por MCP. Y el agente recibe el mínimo de instrucciones posibles para saber cuándo llamarlas.

---

# 13. MCP server `logbook-mcp` (interfaz primaria)

`logbook init` registra LogBook como MCP server local en `.mcp.json` (project-scoped). El servidor corre como un proceso local cuando Claude Code lo invoca.

## 13.1 Tools expuestas

Todas las descripciones de tools están **optimizadas para mínimo coste de tokens**: una línea por tool, parámetros con descripción solo si no son evidentes.

```json
{
  "tools": [
    {
      "name": "logbook_decision",
      "description": "Log an architecture decision with alternatives and rationale.",
      "input": {
        "title": "string",
        "alternatives": "string[]?",
        "why": "string?",
        "tradeoffs": "string[]?"
      }
    },
    { "name": "logbook_error",      "description": "Log a didactic error.",                "input": { "title": "string", "symptom": "string?" } },
    { "name": "logbook_fix",        "description": "Link a fix to an error.",              "input": { "summary": "string", "errorId": "string?" } },
    { "name": "logbook_lesson",     "description": "Log a lesson learned (human-authored).","input": { "text": "string", "linkTo": "string?" } },
    { "name": "logbook_resource",   "description": "Log an external resource.",            "input": { "url": "string", "note": "string?" } },
    { "name": "logbook_milestone",  "description": "Close a phase with a milestone.",      "input": { "title": "string", "next": "string?" } },
    { "name": "logbook_phase",      "description": "Switch active phase.",                 "input": { "name": "string" } },
    { "name": "logbook_suggest",    "description": "Queue a suggestion for human review.", "input": { "type": "string", "payload": "object" } },
    { "name": "logbook_state",      "description": "Get current phase, session, pending.", "input": {} }
  ]
}
```

## 13.2 Reglas para mantenerse barato

1. Descripciones de 1 línea (≤ 12 palabras)
2. Sin ejemplos en la descripción (los ejemplos van en `reference.md` que se lee bajo demanda)
3. Parámetros opcionales marcados con `?` sin más texto si el nombre es claro
4. `logbook_state` devuelve un JSON ultracompacto: `{"phase":"arch","session":"abc","pending":7}`

## 13.3 Política de uso

- El agente llama estas tools **proactivamente** cuando reconoce el patrón (instruido por la Skill).
- Para acciones reversibles (decision, error, fix, resource, milestone): ejecuta directamente.
- Para `lesson` y `promote`: llama `logbook_suggest` en vez de la tool directa, porque solo el humano debe crear lessons.

## 13.4 Coexistencia MCP

LogBook se registra como MCP server con nombre único `logbook-mcp`. Si el usuario ya tiene otros MCP servers, `.mcp.json` se edita append-only y con backup. Si existe colisión de nombre, `logbook init` aborta y propone `--mcp-name`.

---

# 14. Hooks como red de seguridad

Los hooks ya no son la interfaz primaria, sino la red de seguridad para capturar lo que el agente no pasó por MCP.

## 14.1 Eventos capturados

Prioridad alta: `SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, SessionEnd, PostCompact`.

Prioridad media: `FileChanged, CwdChanged, WorktreeCreate, WorktreeRemove, Notification, PermissionRequest, PermissionDenied`.

## 14.2 Comando

```bash
logbook ingest claude   # lee JSON por stdin, escribe en JSONL, sale rápido
```

Reglas: p95 < 200 ms, nunca exit code distinto de 0, JSON inválido se guarda crudo en `evidence/raw-notes/`. Degradación silenciosa con warning en `state.json`.

## 14.3 Protocolo de coexistencia (detalle en §24)

Cada hook que LogBook añade lleva un id `lb-hook-<event>-<n>`. Ver §24 para el protocolo completo.

---

# 15. OTel nativo

Claude Code emite OTel desde 2026 (sesiones, líneas, commits, PRs, coste, tokens, accept/reject, active time). LogBook lo aprovecha así:

1. `logbook init` opcionalmente configura las env vars (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, endpoint OTLP local) en un `.envrc` o sugerencia para el shell del usuario.
2. Lanza un mini-colector OTLP en background (proceso hijo, `127.0.0.1` only).
3. Persiste exports crudos en `evidence/otel/` y líneas normalizadas en `events.jsonl` con `source: claude-code-otel`.
4. Si el usuario no quiere colector local, OTel se omite y todo va por hooks.

---

# 16. Skill `logbook-auto-capture`

## 16.1 Naturaleza

Una Skill es un fichero de instrucciones que el agente lee cuando detecta un patrón disparador. **No corre en background**, es reactiva a turnos del agente.

Con MCP ya disponible, la Skill cambia de naturaleza: deja de "ejecutar comandos por shell" y pasa a **instruir al agente sobre cuándo llamar las MCP tools de LogBook**. Más limpio y mucho más barato en tokens.

## 16.2 Diseño con disclosure progresiva

```
.claude/skills/logbook-auto-capture/
  SKILL.md            # 30-50 líneas, lo único que se carga por defecto
  reference.md        # detalle (cuándo no hacerlo, edge cases) — solo si el agente lo lee
```

## 16.3 SKILL.md (ejemplo minimalista)

```md
---
name: logbook-auto-capture
description: Suggest or log key project moments via logbook-mcp when patterns appear.
triggers: [decision, alternative, error, fix, milestone, phase change, resource]
---

# When to act

Use logbook-mcp tools when the conversation contains these patterns.

## Auto-log silently (just call the tool, no confirmation)
- Used WebFetch/WebSearch → logbook_resource(url, brief note)
- Subagent invoked → already in hooks, no action needed

## Suggest with one-line confirmation
- Compared alternatives and chose one → logbook_suggest("decision", {title, alternatives, why})
- Pattern "tried N times, fixed by refactor" → logbook_suggest("error+fix", {...})
- Phase shift in conversation (e.g. "let's start implementing") → logbook_suggest("phase", {name})
- Significant work completed → logbook_suggest("milestone", {title})

## Never auto-execute
- logbook_lesson: only humans author lessons. Use logbook_suggest("lesson", ...) at most.

## Style
- One line per suggestion. No flourish.
- Skip if logbook_state.phase == "off".
- See reference.md only if you need edge cases.
```

## 16.4 Coste estimado en tokens

| Componente | Tokens aprox |
| --- | --- |
| SKILL.md cargado | ~250 |
| reference.md (bajo demanda) | ~400 |
| Tool descriptions MCP | ~120 |
| **Total fijo en contexto** | **~370** |

Comparativa: una skill mal escrita con ejemplos puede ocupar 2000–4000 tokens por turno. Tarjeta amarilla en la Definition of Done si supera 500.

---

# 17. Slash commands

Ficheros markdown en `.claude/commands/` con el prefijo `lb-` para namespacing. Coste en tokens: **0 mientras no se invocan**.

Lista mínima del MVP:

```
lb-decision.md   → invoca MCP logbook_decision con los args
lb-error.md      → idem error
lb-fix.md        → idem fix
lb-lesson.md     → idem lesson (autoría humana)
lb-milestone.md  → idem milestone
lb-phase.md      → idem phase
lb-review.md     → lanza logbook review en una terminal lateral o resumen en chat
lb-status.md     → muestra el state actual
```

## 17.1 Ejemplo `lb-decision.md` (minimal)

```md
---
name: lb-decision
description: Log an architecture decision.
---

Call MCP tool `logbook_decision` with the user's args. If alternatives or rationale are missing, ask once for both in a single line.
```

## 17.2 Coexistencia

Si el usuario ya tiene comandos `lb-*` instalados de otra fuente, `logbook init` aborta y propone prefijo alternativo (`--cmd-prefix lbk` por ejemplo).

---

# 18. Augment de `CLAUDE.md`

LogBook añade un bloque delimitado al `CLAUDE.md` del proyecto (lo crea si no existe).

```md
<!-- logbook:claudemd start v=1 -->
## LogBook (project documentation)

This project uses LogBook. When you detect: a decision with alternatives, a tool failure pattern, a phase shift, or an external resource consulted — use the `logbook-mcp` tools to capture it. See skill `logbook-auto-capture` for triggers.

Active state: see `logbook_state` tool. Conventions: ADRs in `logbook/decisions/`, events in `.logbook/`.
<!-- logbook:claudemd end -->
```

## 18.1 Reglas

- Bloque ≤ 60 tokens en contexto
- Delimitadores `<!-- logbook:claudemd -->` para uninstall quirúrgico
- Si `CLAUDE.md` no existe, se crea solo con este bloque
- Coexistencia: nunca se toca contenido fuera de los marcadores; backup previo en `.logbook/backups/CLAUDE.md.pre-logbook`

## 18.2 Detalle bajo demanda

El detalle extenso (cómo funciona cada tool, edge cases) vive en `.logbook/AGENT_NOTES.md`. El bloque del CLAUDE.md solo lo menciona. El agente lo lee si lo necesita; el coste por turno queda en 60 tokens.

---

# 19. Statusline

Statusline customizado de Claude Code: información ambiente, **coste en tokens 0** (es UI fuera del contexto).

```
📓 architecture · sess: Diseño inicial · 7 pendientes · 2h
```

Se instala como configuración de statusline en `.claude/settings.local.json` con id `lb-statusline-001`. Si el usuario ya tiene un statusline, LogBook no lo reemplaza; propone integrarse o desactivar el suyo.

---

# 20. Memoria persistente entre sesiones

Una de las funciones de **mayor valor diferencial** y bajo coste.

## 20.1 Cómo funciona

Al iniciar una sesión Claude Code (evento `SessionStart`), el hook correspondiente:

1. Lee `.logbook/state.json` y SQLite index
2. Construye un resumen ultracompacto (≤ 80 tokens)
3. Lo inyecta como mensaje de sistema o lo escribe en `.logbook/AGENT_NOTES.md` para que la Skill lo cargue

Ejemplo de payload inyectado:

```
LogBook context: phase=architecture, session=abc123 ("Diseño inicial").
Recent: decided Next.js (2h ago). Open errors: 1 (scraping mixed concerns).
Review queue: 7 items pending.
```

## 20.2 Coste

| Campo | Tokens |
| --- | --- |
| Header | 5 |
| Estado básico | 25 |
| Última decisión | 20 |
| Errores abiertos | 15 |
| Cola review | 8 |
| **Total** | **~75** |

Tope duro: si el resumen excede 120 tokens, se trunca y se sustituye por "ver `logbook_state` tool".

## 20.3 Diferencia con Engram de gentle-ai

Engram es memoria general entre sesiones. LogBook hace lo mismo, pero solo para su dominio (estado del proyecto documentado). No compite, complementa.

---

# 21. Subagentes especializados

Dos subagentes instalados solo en preset `teaching` (o vía `artifacts add`):

## 21.1 `logbook-curator`

Subagente con tool access restringido a las MCP tools de LogBook. Reemplaza al TUI Ink para usuarios que prefieran curar conversacionalmente.

Invocación: `Use the logbook-curator subagent to review pending items`.

Coste: cero en contexto principal (subagente corre con su propia ventana).

## 21.2 `logbook-teacher`

Subagente dedicado a generar `teaching-script.md`. Prompt afinado, tool access a `logbook_state`, lectura de Markdown generado, y llamada al modelo configurado para tarea `teaching-script` en `providers.json`.

Coste: cero en contexto principal.

## 21.3 Ficheros

```md
---
name: logbook-curator
description: Conversational curator for LogBook pending items.
tools: [logbook_state, logbook_suggest, ... limitadas]
---
You are LogBook's curator. ...
```

Cuerpo ≤ 200 tokens cada uno.

---

# 22. Sistema de presets

Inspirado en gentle-ai. El usuario elige superficie de instalación.

| Preset | Instala |
| --- | --- |
| `minimal` | CLI + hooks + OTel optional. Sin nada en `.claude/` excepto hooks etiquetados. |
| `standard` | minimal + MCP server + slash commands + Skill + statusline + augment CLAUDE.md |
| `teaching` | standard + subagentes + memoria persistente (SessionStart inject) |
| `custom` | TUI interactiva que pregunta uno a uno |

Cada preset registra en el manifiesto qué artefactos instaló para que `uninstall` los retire selectivamente.

---

# 23. Economía de tokens — reglas

Capítulo clave de esta revisión. Cada artefacto que LogBook coloca en el contexto del agente cumple estas reglas.

## 23.1 Reglas duras

1. **Tope de contexto fijo combinado: 500 tokens.** Suma de SKILL.md cargado + bloque CLAUDE.md + inyección SessionStart + descripciones MCP. Si se excede, falla la Definition of Done.
2. **Disclosure progresiva.** Lo poco frecuente vive en `reference.md` o `AGENT_NOTES.md` y se lee solo cuando hace falta.
3. **Descripciones MCP de 1 línea**, sin ejemplos.
4. **Sin redundancia entre artefactos.** Cada hecho vive en un solo sitio: si está en MCP tool description, no se repite en SKILL.md ni en CLAUDE.md.
5. **`logbook_state` responde JSON ultracompacto** (≤ 30 tokens en respuesta típica).
6. **Memoria persistente truncada a 120 tokens**.
7. **Slash commands minúsculos** (≤ 30 tokens cada uno) — invocados, no constantes.
8. **Subagentes con prompt ≤ 200 tokens cada uno**.

## 23.2 Reglas blandas

1. Acrónimos comunes sin expandir (`MCP`, `ADR`, `OTel`).
2. Sin saludos ni cierres ("you are an expert..." prohibido).
3. Inglés en las instrucciones del agente (Claude tokeniza inglés más eficiente).
4. Markdown plano, sin tablas innecesarias.
5. Verbos imperativos, sin condicionales largos.

## 23.3 Prompts internos para LLM

Los prompts que LogBook usa internamente para resumir milestones, generar teaching-script, sugerir nombres de sesión, etc., siguen el mismo régimen:

| Tarea | Modelo recomendado | Prompt + input tope |
| --- | --- | --- |
| `session-rename` | Haiku 4.5 | ≤ 300 tokens |
| `milestone-summary` | Sonnet 4.6 | ≤ 1500 tokens |
| `teaching-script` | Opus 4.6 | ≤ 4000 tokens |
| `redact-check` | Haiku 4.5 | ≤ 800 tokens |

Y todos llevan instrucción explícita "no inventes, separa hechos de interpretación".

## 23.4 Medición

`logbook doctor --measure` estima el coste de cada artefacto y lo reporta. Es test automatizado en CI.

---

# 24. Coexistencia con otros plugins y hooks

Segundo capítulo clave. LogBook debe convivir con otras herramientas que tocan los mismos ficheros (`.claude/settings.local.json`, `CLAUDE.md`, `.mcp.json`, `.gitignore`).

## 24.1 Principios

1. **Discovery antes de instalar.** `logbook init` lee primero todos los ficheros compartidos y muestra qué hay. Si detecta entradas de plugins conocidos (gentle-ai, claude-code-hooks-mastery, awesome-claude-plugins, etc.) lo dice.
2. **Append-only.** Nunca rewrite. Solo se añaden entradas.
3. **Tagging por owner.** Cada entrada que LogBook añade lleva un id `lb-*`. Para formatos JSON donde no se pueden añadir comentarios, el manifiesto guarda el JSON Path donde insertó la entrada y un hash de su contenido para identificarla en uninstall.
4. **Backup previo automático.** Antes de cualquier escritura en archivo ajeno, copia a `.logbook/backups/<archivo>.pre-logbook` con timestamp si ya existe el anterior.
5. **Idempotencia.** Si `logbook init` se ejecuta dos veces, la segunda detecta entradas existentes vía manifiesto o por matching de comando (`logbook ingest`) y no duplica.
6. **Settings file scope correcto.** LogBook **siempre** escribe en `.claude/settings.local.json` (project-local, gitignored). Nunca en user-level (`~/.claude/settings.json`) ni en shared project settings.

## 24.2 Protocolo de inserción de hooks

```json
{
  "hooks": {
    "PostToolUse": [
      { /* entrada del usuario o de otro plugin: NO se toca */ },
      {
        "_logbookId": "lb-hook-PostToolUse-001",
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "logbook ingest claude" }
        ]
      }
    ]
  }
}
```

Si el formato no permite `_logbookId`, el manifiesto guarda:

```json
{
  "type": "hook-added",
  "file": ".claude/settings.local.json",
  "jsonPath": "$.hooks.PostToolUse[1]",
  "contentHash": "sha256:..."
}
```

Y en uninstall localiza por `jsonPath + contentHash`.

## 24.3 Orden de ejecución

Por defecto LogBook **se inserta al final** de cada array de hooks (corre el último). Razones:

1. No interfiere con hooks que validan o gatekeepean
2. Si otro plugin aborta el flujo, LogBook no captura nada falso

Avanzado: `logbook init --order first|last|after:<id>` para casos específicos.

## 24.4 Detección de plugins conocidos

`logbook doctor` mantiene una lista de fingerprints de plugins populares (rutas de comandos, nombres de hooks típicos) y avisa de:

- Plugins que también escriben en `events.jsonl` o similar
- Plugins que también usan los prefijos `/lb-`
- Plugins que también registran un MCP server llamado `logbook*`
- Plugins que también modifican `CLAUDE.md` sin delimitadores claros

## 24.5 Hook commands robustos

- Usan el binario `logbook` resuelto a path absoluto en el momento de la instalación. Si LogBook se instala global con `pnpm add -g`, el path absoluto es el del bin global de pnpm; si se instala local con `pnpm add -D`, se usa `pnpm exec logbook ingest claude`. Independiente de cwd y PATH
- Si el binario no se encuentra, salen con código 0 y log a `.logbook/state.json` (no bloquean Claude Code)
- Tiempo total p95 < 200 ms

## 24.6 `disableAllHooks: true`

Si el usuario tiene el flag global de Claude Code para desactivar hooks, `logbook init` detecta y advierte: la instalación se hace, pero los hooks no dispararán hasta que el flag se quite.

## 24.7 Convivencia con gentle-ai específicamente

Si LogBook detecta gentle-ai instalado, lo declara como compatible (sus componentes — Engram, SDD, skills, Context7, persona, permissions, GGA — viven en namespaces distintos al de LogBook). No hay conflicto esperado. `doctor` lo confirma.

## 24.8 Test obligatorio del ciclo

Hay un test e2e que: instala otro plugin de prueba, instala LogBook, desinstala LogBook, comprueba que la configuración del otro plugin queda **idéntica byte a byte** a la previa.

---

# 25. Multi-proveedor LLM

## 25.1 Capa única

**Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.) como única forma de llamar a un LLM desde LogBook. Razón: equivalente Node/TS a LiteLLM, mantenido oficialmente.

## 25.2 Autenticación preferente

Si hay sesión Claude Code activa con plan Pro/Max/Team/Enterprise, LogBook usa **`@anthropic-ai/claude-agent-sdk`** con el crédito SDK del plan (sin clave API).

Fallback: `ANTHROPIC_API_KEY` env var. Si no hay, desactiva resúmenes con aviso.

## 25.3 Configuración

`.logbook/providers.json`:

```json
{
  "default": { "provider": "anthropic", "model": "claude-sonnet-4-6", "auth": "subscription-sdk" },
  "phases": {
    "discovery":     { "provider": "anthropic", "model": "claude-haiku-4-5" },
    "architecture":  { "provider": "anthropic", "model": "claude-opus-4-6" },
    "debugging":     { "provider": "openai",    "model": "gpt-5-codex", "auth": "env:OPENAI_API_KEY" },
    "retrospective": { "provider": "anthropic", "model": "claude-opus-4-6" }
  },
  "tasks": {
    "milestone-summary": { "inherit": "phase" },
    "teaching-script":   { "provider": "anthropic", "model": "claude-opus-4-6" },
    "redact-check":      { "provider": "anthropic", "model": "claude-haiku-4-5" },
    "session-rename":    { "provider": "anthropic", "model": "claude-haiku-4-5" }
  }
}
```

Reglas: task > phase > default. Auth no disponible → fallback default. `logbook providers test` valida sin gastar tokens significativos.

## 25.4 Codex como motor

Dos vías soportadas:

1. **Codex como MCP server** registrado en `.mcp.json`. Sus llamadas quedan en hooks como cualquier otra tool. LogBook no necesita código.
2. **Codex como subprocess** vía `codex exec` para pipelines internas de LogBook. Lo invoca Vercel AI SDK si existe el provider compatible, o spawn directo en `connectors/codex.ts`.

---

# 26. Modelo de datos

## 26.1 Evento base (alineado OTel-genai)

```json
{
  "id": "01HXYZ...",
  "schemaVersion": 3,
  "createdAt": "2026-05-15T10:30:12.000Z",
  "source": "claude-code",
  "sourceEvent": "UserPromptSubmit",
  "eventType": "ai.prompt.submitted",
  "gen_ai": {
    "system": "anthropic",
    "request":  { "model": "claude-sonnet-4-6" },
    "response": { "model": "claude-sonnet-4-6" },
    "usage":    { "input_tokens": 0, "output_tokens": 0 }
  },
  "projectRoot": "/Users/jose/project",
  "phase": "architecture",
  "session": { "id": "abc123", "name": "...", "transcriptPath": "..." },
  "git":     { "branch": "main", "commit": "abcde12", "dirty": true, "filesChanged": ["src/foo.ts"] },
  "payload": {},
  "links": [],
  "tags": [],
  "visibility": "internal",
  "teachingValue": "unknown"
}
```

## 26.2 Tipos de evento

```
project.started  project.phase.changed  project.milestone.created
ai.session.started  ai.session.ended
ai.prompt.submitted  ai.response.completed
ai.tool.started  ai.tool.completed  ai.tool.failed
ai.subagent.started  ai.subagent.completed
ai.task.created  ai.task.completed
git.snapshot  git.commit.detected
manual.decision  manual.error  manual.fix  manual.lesson  manual.resource  manual.visual  manual.promotion
mcp.tool_call                              # invocaciones a logbook-mcp
agent.suggestion                           # sugerencia encolada por la Skill
summary.generated  export.generated
install.modification  uninstall.action
```

## 26.3 Otras entidades

Sesión, Decisión (con ADR Nygard en `logbook/decisions/NNNN-slug.md`), Error didáctico, Sugerencia pendiente. (Mismo modelo conceptual que v2, sin cambios aquí.)

## 26.4 Índice SQLite

`.logbook/index.sqlite` reconstruible desde JSONL con `logbook build --rebuild-index`. Tablas: events, sessions, decisions, errors, fixes, lessons, resources, milestones, suggestions, links, state. JSONL es fuente de verdad; SQLite es caché.

---

# 27. Generación de documentos

## 27.1 Pipeline

`unified + remark + remark-stringify` para Markdown; `rehype + rehype-shiki` para HTML. Determinista, idempotente.

## 27.2 Protección de ediciones humanas

Marcadores delimitados en todos los documentos generados:

```md
<!-- logbook:generated start id="timeline-architecture" -->
...
<!-- logbook:generated end -->
```

`logbook build` solo regenera dentro de los marcadores. Si el usuario los borra, ese bloque queda fuera del control automático. Cualquier cambio destructivo se reporta con diff antes de aplicar.

## 27.3 Documentos generados

`index.md`, `timeline.md`, `decisions/` (ADR Nygard), `errors-and-lessons.md`, `prompts.md` (curado), `teaching-script.md`, `resources.md`, `metrics.md`.

---

# 28. Curación humana — `logbook review`

TUI en **Ink** que recorre eventos sin clasificar y sugerencias pendientes (`pending-suggestions.jsonl`). El usuario:

1. Promociona/descarta en lote
2. Asigna `teachingValue` (high, medium, low, must_show, hide)
3. Vincula error con fix
4. Etiqueta prompts fundacionales
5. Añade nota corta
6. Marca `showInClass`

Triggers: manual, al cerrar milestone, recordatorio periódico en `logbook status`.

Alternativa conversacional: subagente `logbook-curator` (en preset teaching).

---

# 29. Clasificación de valor didáctico

`teachingValue ∈ {unknown, low, medium, high, must_show, hide}`. Reglas iniciales:

1. Errores manuales → high
2. Fixes manuales → high
3. Lessons manuales → must_show
4. Tool failures → medium
5. Subagent usage → medium
6. Prompts largos con decisiones → medium
7. Eventos repetitivos → low
8. Secrets o datos sensibles → hide

El usuario sobreescribe en `review`.

---

# 30. Seguridad y privacidad

1. Nada se sube a servidores externos salvo llamadas LLM explícitas.
2. **Redacción**: reglas portadas de Gitleaks (cientos de patrones) + detección por entropía (estilo detect-secrets). Aplicada a `tool_response`, `stdout`, `stderr`, contenido capturado. Marca: `[REDACTED:tipo]`.
3. **`logbook export --safe`**: reemplaza paths absolutos, usernames, hostnames; lista reemplazos en `exports/safe-report.md`; dry-run obligatorio.
4. `.gitignore` se actualiza para `.logbook/state.json`, `.logbook/index.sqlite`, `.logbook/backups/`.

---

# 31. Seguridad del MCP server

`logbook-mcp` es código first-party (no descargado de terceros) y se diseña con superficie mínima de ataque. Esta sección lista los requisitos verificables.

## 31.1 Requisitos no negociables

1. **Transporte stdio local exclusivamente** en el MVP. Sin HTTP, sin WebSocket, sin escucha remota. Claude Code lanza el server como proceso hijo.
2. **Project-scoped registration** en `.mcp.json` (project-local). Nunca se registra en user-level `~/.mcp.json` para evitar exposición cross-proyecto.
3. **Sin ejecución de shell** desde tools del MCP. Las tools llaman únicamente a funciones TypeScript del CLI, auditables.
4. **Sin paso de credenciales del agente al server.** Si el server necesita autenticación (Agent SDK), la lee de su propia configuración, no del cliente.
5. **Validación de input con valibot** en cada tool. Esquemas estrictos, sin pass-through de payloads arbitrarios. Rechaza campos extra no declarados.
6. **Confinamiento de paths al project root.** Cualquier argumento que represente un path se normaliza con `path.resolve` y se verifica que cae dentro de `projectRoot`. Cualquier escape (`..`, symlinks fuera del repo) se rechaza.
7. **Topes de tamaño por campo**: título ≤ 500 chars, contenido ≤ 8 KB. No se aceptan blobs binarios.
8. **Rate limit local laxo**: 20 calls/segundo por tool. Protege contra bucles accidentales.
9. **Auditoría completa**: cada llamada se persiste como evento `mcp.tool_call` con args completos *antes* de aplicar el efecto. Permite forense.
10. **Append-only en JSONL con file locking.** Lock advisorio (`proper-lockfile`) en cada append para soportar sesiones concurrentes sin corrupción.
11. **Sin red saliente desde el MCP server.** Cualquier llamada a LLM va por la capa `llm/` del CLI, nunca desde el server, y siempre con consentimiento explícito.
12. **Lectura confinada**: el server solo lee dentro de `.logbook/`, `logbook/` y `.git/` (este último read-only y solo para metadatos).
13. **Versión del SDK MCP fijada**: dependencia `@modelcontextprotocol/sdk` con versión exacta en `pnpm-lock.yaml`. Actualizaciones con changelog revisado y tests de regresión.

## 31.2 Riesgos residuales declarados

1. **Inyección semántica vía Skill.** Un prompt injection externo podría inducir a Claude a llamar tools con contenido manipulado. La consecuencia es documentación contaminada, no ejecución de código. Mitigación: usar `agent.suggestion` para casi todo y exigir curación humana en `logbook review` antes de aceptar.
2. **MCPs de terceros instalados por el usuario.** LogBook no puede aislar lo que hacen otros MCPs en la misma sesión. Mitigación: `logbook doctor` lista MCPs detectados; el usuario decide.
3. **Bug en una tool del MCP que corrompe JSONL.** Mitigación: append-only nunca sobreescribe; líneas corruptas se detectan y se mueven a `evidence/raw-notes/corrupted/` durante `build`.
4. **MCP es un protocolo joven** (≤ 2 años en 2026). Mitigación: seguimiento del changelog del SDK y tests de regresión al subir versión.

## 31.3 Tests obligatorios de seguridad

1. Path traversal: rechaza `../../etc/passwd` y symlinks fuera del repo
2. Tamaño: rechaza payload > 8 KB
3. Rate limit: rechaza la llamada 21 dentro del mismo segundo
4. Schema strict: rechaza campos no declarados
5. Concurrencia: dos llamadas simultáneas no corrompen el JSONL
6. Aislamiento de lectura: la tool no puede leer fuera de los directorios permitidos
7. Sin red: el proceso del server no abre sockets salientes durante una corrida completa de tests

---

# 32. Instalación, desactivación y desinstalación

Sistema de primer nivel. Extiende v2 para cubrir todos los nuevos artefactos.

## 31.1 Manifiesto

`.logbook/install-manifest.json` registra cada modificación:

```json
{
  "version": "0.1.0",
  "preset": "standard",
  "installedAt": "2026-05-15T10:00:00Z",
  "artifacts": [
    { "kind": "hook",       "file": ".claude/settings.local.json", "jsonPath": "$.hooks.PostToolUse[1]", "id": "lb-hook-PostToolUse-001", "hash": "sha256:..." },
    { "kind": "mcp-server", "file": ".mcp.json",            "jsonPath": "$.mcpServers.logbook-mcp", "id": "lb-mcp-001" },
    { "kind": "slash",      "file": ".claude/commands/lb-decision.md", "id": "lb-slash-decision" },
    { "kind": "skill",      "file": ".claude/skills/logbook-auto-capture/SKILL.md", "id": "lb-skill-auto" },
    { "kind": "subagent",   "file": ".claude/subagents/logbook-curator.md", "id": "lb-sub-curator" },
    { "kind": "claudemd",   "file": "CLAUDE.md", "marker": "logbook:claudemd", "id": "lb-claudemd-001",
      "backup": ".logbook/backups/CLAUDE.md.pre-logbook" },
    { "kind": "statusline", "file": ".claude/settings.local.json", "jsonPath": "$.statusLine", "id": "lb-statusline-001",
      "backup": ".logbook/backups/settings.local.json.pre-logbook" },
    { "kind": "gitignore",  "file": ".gitignore", "addedLines": [".logbook/state.json"], "id": "lb-gitignore-001" }
  ]
}
```

## 31.2 Tres niveles

- **`logbook disable`** — silencia sin tocar archivos (flag interno + skip en hooks). Reversible con `enable`.
- **`logbook uninstall [--dry-run]`** — retira cada artefacto del manifiesto. Por archivo JSON: localiza por `jsonPath + hash` y elimina entrada. Por archivo Markdown: elimina bloque entre marcadores. Por archivo propio (`SKILL.md`, slash commands, subagentes): elimina fichero. Conserva `logbook/` y `.logbook/backups/`.
- **`logbook purge --force`** — uninstall + borra `logbook/` y `.logbook/`. Confirmación explícita.

## 31.3 `--dry-run` obligatorio

Todos los comandos destructivos. Imprime exactamente qué tocaría, con paths y hashes.

## 31.4 Edición quirúrgica de ajenos

- Read → parse → modify in memory → write only if changed
- Backup previo si no existe
- Si fichero ajeno cambió desde el último backup, crear nuevo backup con timestamp y avisar

## 31.5 `logbook doctor`

Diagnóstico exhaustivo:

1. Artefactos del manifiesto que ya no existen en disco
2. Artefactos en disco no registrados en manifiesto
3. Hooks apuntando a binario inexistente
4. `disableAllHooks: true` activado
5. Plugins conocidos detectados y compatibilidad
6. Crédito SDK agotado
7. Colector OTel caído
8. Coste estimado de tokens por artefacto cargado

## 31.6 Test e2e crítico

Test que: instala otros 2 plugins de prueba, instala LogBook con preset `standard`, desinstala LogBook, verifica que los otros 2 plugins quedan **idénticos byte a byte** y que `.claude/` no contiene rastro de LogBook.

---

# 33. IA dentro de LogBook

1. **Generación determinista primero.** `logbook build` no requiere IA.
2. **Resúmenes opcionales con IA** vía `logbook summarize`. Se guardan en `evidence/summaries/` y se inyectan en Markdown como bloques delimitados `<!-- logbook:summary -->`.
3. **Regla de oro:** IA añade narrativa, nunca inventa evidencia. Prompt interno lo refuerza explícitamente.

Prompt interno base (~80 tokens):

```
You convert dev events into didactic docs. Don't invent. Separate facts from interpretation. If evidence is insufficient, say so. Output: goal, what happened, decisions, errors, fixes, teaching moments, evidence event-ids, next steps.
```

---

# 34. Stack tecnológico

| Necesidad | Librería |
| --- | --- |
| Runtime | Node 22 LTS |
| Lenguaje | TypeScript estricto |
| CLI | citty |
| TUI | Ink |
| Validación | valibot |
| Índice | better-sqlite3 |
| Markdown | unified + remark + remark-stringify |
| HTML | rehype + rehype-stringify + rehype-shiki |
| Diagramas | mermaid-cli opcional |
| IDs | crypto.randomUUID o uuidv7 |
| LLMs | Vercel AI SDK + Claude Agent SDK |
| MCP | `@modelcontextprotocol/sdk` (TS) |
| Tests | vitest |
| Secret scan | reglas Gitleaks portadas + entropía |
| Git | spawn nativo o simple-git |
| Logs internos | consola (UnJS) |

Distribución: **pnpm** como gestor primario (lockfile `pnpm-lock.yaml`); publicación en npm registry para que el usuario pueda instalar con `pnpm add -g @yourorg/logbook`. SEA (Node Single Executable Application) opcional como alternativa para usuarios sin Node.

---

# 35. Estructura de código

```text
src/
  cli/
    index.ts
    commands/  init.ts doctor.ts status.ts disable.ts enable.ts uninstall.ts purge.ts
               start.ts phase.ts session.ts ingest.ts
               decision.ts error.ts fix.ts lesson.ts resource.ts visual.ts milestone.ts snapshot.ts
               review.ts promote.ts build.ts summarize.ts export.ts
               providers.ts artifacts.ts
  core/        config.ts paths.ts ids.ts time.ts manifest.ts
  redact/      rules-gitleaks.ts entropy.ts anonymize.ts
  store/       append-event.ts read-events.ts write-json.ts sqlite-index.ts state.ts
  connectors/
    claude-code/
      hooks-install.ts hooks-uninstall.ts otel-collector.ts mapping.ts
      artifacts/        # cada tipo con install/uninstall propio
        mcp.ts skill.ts slash.ts subagent.ts claudemd.ts statusline.ts gitignore.ts
      detect-plugins.ts # fingerprints de plugins conocidos
    codex/             exec.ts mcp.ts
    git.ts
  mcp/                 # logbook-mcp server
    server.ts
    tools/             decision.ts error.ts fix.ts lesson.ts resource.ts milestone.ts
                       phase.ts suggest.ts state.ts
  normalize/           normalize-claude-event.ts normalize-codex-event.ts classify-event.ts teaching-value-rules.ts
  llm/                 provider-router.ts claude-sdk.ts summarize.ts guards.ts
  generate/            index-doc.ts timeline-doc.ts decisions-doc.ts errors-doc.ts prompts-doc.ts resources-doc.ts metrics-doc.ts teaching-script-doc.ts blocks.ts
  review/              tui.ts flows.ts
  export/              html.ts pdf.ts instructor-pack.ts safe.ts
  types/               event.ts config.ts providers.ts manifest.ts docs.ts artifacts.ts

assets/
  artifacts/           # plantillas de los ficheros instalados
    skill/SKILL.md       skill/reference.md
    slash/lb-*.md
    subagents/logbook-curator.md   logbook-teacher.md
    claudemd-block.md
    mcp.json.template

tests/
  unit/ integration/ e2e/
  fixtures/
    other-plugins/     # plugins de prueba para test de coexistencia
```

---

# 36. Iteraciones de implementación

## Iteración 1 — Núcleo + ciclo install/uninstall fiable

1. Setup TypeScript + vitest
2. CLI con citty (`init`, `status`, `doctor`, `disable`, `enable`, `uninstall --dry-run`, `purge --force`)
3. **Manifiesto desde el día uno**
4. Estructura de carpetas, `events.jsonl`, `config.json`, `providers.json`, `state.json`
5. `logbook ingest claude` (stdin → JSONL)
6. Instalación quirúrgica de hooks (preset minimal) con backup y tagging
7. Redacción Gitleaks
8. SQLite index reconstruible
9. **Test e2e crítico: install + uninstall byte-idéntico**

## Iteración 2 — Marcadores manuales + MCP server + export feo

1. `start`, `phase`, `session rename`, `snapshot`
2. Comandos manuales (`decision`, `error`, `fix`, `lesson`, `resource`, `visual`, `milestone`)
3. **`logbook-mcp` server con sus 9 tools**
4. Slash commands `/lb-*`
5. Augment de `CLAUDE.md` (bloque delimitado)
6. Generación determinista de `index.md`, `timeline.md`, `errors-and-lessons.md`
7. ADRs Nygard en `decisions/`
8. `export html` con CSS propio sin internet
9. Marcadores `<!-- logbook:generated -->`

## Iteración 3 — Curación + Skill + IA básica

1. `logbook review` con Ink
2. `promote`
3. Skill `logbook-auto-capture` (SKILL.md + reference.md)
4. Integración con Vercel AI SDK + Claude Agent SDK
5. `summarize milestone`
6. `providers list/set/test`
7. `teaching-script.md` con IA

## Iteración 4 — OTel + Codex + subagentes + memoria persistente

1. Colector OTel local
2. Codex como subprocess y como MCP documentado
3. Subagentes `logbook-curator` y `logbook-teacher`
4. Memoria persistente inyectada en `SessionStart`
5. Statusline
6. `export --safe`

## Iteración 5 — Pulido profesional + presets

1. Preset `teaching` completo
2. `instructor-pack.html` y `.pdf`
3. Mermaid en export
4. README definitivo
5. Distribución SEA opcional
6. `logbook doctor --measure` para coste de tokens

---

# 37. Definition of Done del MVP

1. Se instala vía `pnpm add -g` (también compatible con npm/yarn/bun para el usuario final)
2. `init` con cualquier preset funciona idempotente
3. **Test e2e byte-idéntico de install/uninstall pasa**
4. Hooks conviven con al menos 2 plugins de prueba
5. MCP server `logbook-mcp` responde con sus 9 tools
6. Slash commands `lb-*` funcionan
7. Skill, CLAUDE.md augment, statusline correctamente instalados
8. Subagentes operativos en preset teaching
9. Memoria persistente inyecta ≤ 120 tokens
10. **Tope combinado de 500 tokens fijos en contexto** verificado por `doctor --measure`
11. `review` end-to-end con 3 flujos
12. `build` regenera sin pisar ediciones humanas
13. ADRs Nygard se generan
14. `teaching-script.md` útil con resúmenes IA
15. `errors-and-lessons.md` con valor didáctico
16. HTML estático sin internet
17. `instructor-pack.html` listo
18. `export --safe` anonimiza
19. Multi-proveedor probado con Anthropic + OpenAI
20. Suscripción Claude funciona sin clave API
21. Hooks p95 < 200 ms
22. No se sube nada salvo llamadas LLM explícitas
23. Tests unitarios + integración + e2e verdes
24. README ≤ 5 min de lectura

---

# 38. Tests mínimos

## Unit

1. Normalización de cada evento de Claude Code
2. Redacción Gitleaks (positivos y negativos)
3. Entropía detecta secretos sin patrón conocido
4. JSONL append seguro frente a concurrencia
5. SQLite index reconstruido idéntico al JSONL
6. Generación con marcadores idempotente
7. ADR Nygard válido
8. Métricas
9. Provider router por fase/tarea
10. Manifest registra cada artefacto
11. MCP tools devuelven schemas válidos

## Integration

1. `init --preset minimal` → solo hooks
2. `init --preset standard` → todos los artefactos
3. `ingest claude` p95 < 200 ms
4. MCP `logbook_decision` crea evento y ADR
5. `build` preserva ediciones humanas
6. `export html` sin internet
7. `uninstall` deja archivos idénticos al pre-install
8. `purge` no toca fuera del manifiesto
9. `review` recorre y persiste

## End-to-end

1. **Coexistencia: instalar 2 plugins de prueba + LogBook + uninstall → estado byte-idéntico**
2. Pipeline completo: init, 100 eventos, review, build, export, uninstall
3. `doctor --measure` reporta tokens ≤ 500 totales fijos

---

# 39. Métricas

Sesiones, prompts, tool calls (incl. fallidas), subagentes, tareas, decisiones, errores, fixes, lessons, recursos, tiempo total (OTel `active_time`), duración por fase, tiempo medio error→fix, coste estimado y tokens por sesión/fase.

---

# 40. Output profesional HTML

Portada, resumen ejecutivo, timeline, decisiones (ADRs), errores y lessons, prompts seleccionados, recursos, métricas, anexos.

Diseño: limpio, profesional, imprimible, sin internet, cajas diferenciadas, Shiki precompilado, Mermaid en build.

---

# 41. Criterio editorial

Equilibrio: evidencia completa en `evidence/`, narrativa clara en Markdown, guion en `teaching-script.md`, visuales en `assets/`, export profesional en `exports/`.

Evitar el log técnico infinito y la historia bonita sin evidencia.

---

# 42. Riesgos y decisiones

| Riesgo | Decisión |
| --- | --- |
| Formato interno de transcripts | Guardar `transcript_path`, no parsear como API |
| Demasiada captura → ruido | Curar con `review`, reglas `teachingValue` |
| Bloquear Claude Code | Hooks rápidos, exit 0 siempre |
| Filtrar secretos | Gitleaks + entropía + `hide` |
| Pisar ediciones humanas | Marcadores `<!-- logbook:generated -->` |
| Crédito SDK agotado | Fallback API key o desactivación elegante |
| Eventos renombrados por Anthropic | `mapping.ts` único + tests por evento |
| Conflicto con otro plugin | Edición quirúrgica + manifiesto + `doctor` |
| **Inflar tokens del contexto** | Topes duros + `doctor --measure` en CI |
| **Romper otro plugin al instalar** | Append-only + tagging + backups + test e2e |

---

# 43. Primera versión que aporta valor real

1. Captura prompts, tool calls, fallos y subagentes
2. Guarda session id y transcript path
3. MCP server con sus tools básicas
4. Slash commands operativos
5. `logbook review` interactivo
6. ADRs Nygard generados
7. `teaching-script.md`, `errors-and-lessons.md`, HTML estático
8. `uninstall` deja el repo intacto incluso con otros plugins instalados
9. Funciona con suscripción Claude sin clave API
10. Coste total fijo en contexto ≤ 500 tokens
