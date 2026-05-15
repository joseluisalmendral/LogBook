# Kickoff prompt — LogBook MVP

> Pega este prompt en Claude Code en el repo, una sola vez, para arrancar la construcción.
> Cuando la iteración 1 esté verde, este archivo se puede borrar — el `CLAUDE.md` y la spec son suficientes a partir de ahí.

---

## Prompt a pegar

```text
Quiero construir el MVP de LogBook según la especificación canónica `logbook_mvp_spec_v3.md` (en la raíz de este repo). El archivo `CLAUDE.md` resume las restricciones no negociables.

LogBook es un CLI local en Node.js + TypeScript que documenta proyectos construidos con IA. Se centra en Claude Code y soporta Codex como motor alternativo.

LogBook NO reinventa: ni OTel (Claude Code ya lo emite nativo), ni ADRs (formato Nygard), ni observabilidad general (Langfuse, SigNoz, etc.). ES la capa pedagógica encima — curación humana, narrativa didáctica, export profesional para clase — y un configurador del ecosistema Claude Code con artefactos limpios y desinstalables.

Stack: Node 22 LTS + TS estricto + citty + valibot + better-sqlite3 + JSONL + unified/remark/rehype + Ink + Vercel AI SDK + @anthropic-ai/claude-agent-sdk + @modelcontextprotocol/sdk + vitest. Gestor de paquetes: pnpm exclusivamente.

Restricciones no negociables (resumen — detalle en la spec):

1. KISS, local-first, Markdown-first
2. Economía de tokens: tope combinado ≤ 500 tokens fijos en el contexto del agente (Skill + bloque CLAUDE.md augment + descripciones MCP + memoria persistente). Verificable con `logbook doctor --measure`. Ver §23.
3. Coexistencia con otros plugins: cualquier modificación a archivos compartidos (`.claude/settings.local.json`, `CLAUDE.md`, `.claude/mcp.json`, `.gitignore`) es append-only, etiquetada con id `lb-*`, con backup previo automático, idempotente. Test e2e byte-idéntico install/uninstall obligatorio. Ver §24.
4. Reversibilidad total: manifiesto de instalación + `--dry-run` en todo comando destructivo. Ver §32.
5. Seguridad MCP: stdio local, project-scoped, sin shell exec, valibot en cada input, confinamiento de paths, file locking en JSONL, sin red saliente. Ver §31.
6. MCP server `logbook-mcp` como interfaz primaria del agente. Hooks como red de seguridad (p95 < 200 ms, nunca exit ≠ 0).
7. ADRs en formato Nygard, compatibles con log4brains.
8. Skill + slash commands + statusline + augment CLAUDE.md + subagentes + memoria persistente como artefactos opcionales por preset (`minimal`, `standard`, `teaching`, `custom`).
9. Redacción de secretos (Gitleaks + entropía) desde el primer evento persistido.
10. Modelo de datos alineado con las semantic conventions de OpenTelemetry GenAI.
11. Vercel AI SDK + Claude Agent SDK como única forma de llamar a un LLM. Multi-proveedor configurable por fase y por tarea.
12. Marcadores `<!-- logbook:generated start --> ... <!-- logbook:generated end -->` para proteger ediciones humanas en todo Markdown generado.
13. Priorizar output útil para formación: el `teaching-script.md` y el `instructor-pack.html` son el producto final, no afterthoughts.

---

Tarea inmediata (no escribas código todavía):

Lee la especificación completa. Después responde con un plan que cubra estos puntos, en orden:

1. **Estructura de archivos exacta** del repo `src/` (referencia §35 de la spec, pero confirma o propone ajustes).
2. **Modelo de datos TypeScript** completo: tipos para `Event`, `Session`, `Decision`, `Error`, `Fix`, `Lesson`, `Resource`, `Milestone`, `Suggestion`, `Manifest`, `ProvidersConfig`, `Artifact`. Con todos los campos.
3. **Signatures de los comandos CLI** (función `defineCommand` de citty con args, options, descripciones).
4. **Signatures de las MCP tools** (esquemas valibot de input + output, descripción de una línea cada una).
5. **Estrategia de instalación quirúrgica por tipo de artefacto**: hooks, MCP server, slash commands, Skill, subagentes, augment de CLAUDE.md, statusline, gitignore. Cada uno con `install()` y `uninstall()` simétricos, qué se persiste en el manifiesto, y cómo se detecta colisión con plugins existentes.
6. **Estrategia de discovery y coexistencia**: cómo `logbook init` inspecciona el `.claude/` existente antes de tocar nada, qué reporta al usuario, y cómo decide insertar/abortar.
7. **Estrategia de generación Markdown con marcadores idempotentes**: cómo cada generador encuentra/crea su bloque sin tocar lo de fuera.
8. **Estrategia de tests**: unit, integration y especialmente el e2e crítico de byte-identidad install/uninstall con otros plugins de prueba presentes.

Cuando ese plan esté validado, implementa **la iteración 1 completa** (§36 de la spec) con tests que demuestren:

- `pnpm logbook init --preset minimal` + `pnpm logbook uninstall` deja el repo idéntico al estado inicial (test de byte-identidad pasa)
- Con otro plugin de prueba previamente instalado en `.claude/settings.local.json`, install + uninstall lo dejan idéntico byte a byte
- `logbook ingest claude` por stdin tarda p95 < 200 ms
- Redacción Gitleaks con casos positivos (detecta y redacta) y negativos (no falsos positivos en cadenas inocentes)
- `logbook doctor --measure` reporta 0 tokens de contexto fijo en preset `minimal` (porque no hay artefactos cargados, solo hooks)

No avances a la iteración 2 hasta que estos 5 tests estén verdes.
```

---

## Notas para el humano

- Antes de pegarlo: ejecuta `pnpm init -y` para tener un `package.json` mínimo y haz un primer commit del repo limpio. Así verás con claridad qué genera Claude Code.
- Si Claude Code intenta saltarse el plan e ir directo a codear, recuérdale: "primero el plan, según `CLAUDE.md`".
- Cuando la iteración 1 esté verde, puedes borrar este archivo — el flujo a partir de ahí lo guían `CLAUDE.md` y la spec.
