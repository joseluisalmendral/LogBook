# Test fixtures — provenance

Real-data fixtures are extracted from `logbook/evidence/events.jsonl`. Tests
MUST read these from disk; tests MUST NOT construct event literals inline.
This file documents the exact extraction procedure so the fixtures can be
regenerated deterministically.

## `real-events-narrative.jsonl` (slice 21)

Source session: `ed7da74b-a9c0-4b84-aa3d-098329172696` (the session with the
richest mix of all narrative kinds — sub-agent threads, agent_questions, and
a tail of direct (non-sub-agent) tool_results with `file_path` for the
`filesTouched` rollup test).

The extraction selects two non-contiguous windows from the session timeline
(events 1–600 to cover sub-agent attribution and events 1000–1500 to cover
direct tool rollup with `file_path`), then projects each event down to the
fields the narrative pipeline reads:

- `id`, `timestamp`, `sessionId`, `kind`, `provider`, `schemaVersion`
- `payload.tool_name`, `payload.agentId`, `payload.toolUseId`,
  `payload.text`, `payload.body`, `payload.title`, `payload.description`,
  `payload.question`, `payload.header`, `payload.chosen`, `payload.content`,
  `payload.attributionAgent`
- `payload.raw.agent_id`, `payload.raw.tool_use_id`, `payload.raw.tool_name`
- `payload.raw.tool_input.{file_path,path,notebook_path}`
- `meta.subagentId`, `meta.hook`

Long string values are truncated to 60 chars. `tool_response` arrays are
collapsed to a short string. This keeps the fixture under 500 KB while
preserving every shape the narrative-filter and rollup walker exercise.

To regenerate (one-shot Python — `jq` alternatives are documented in
`scripts/` if/when added):

```bash
python3 <<'PY'
import json
def minify(e):
    out = {"schemaVersion": e.get("schemaVersion", 3),
           "id": e["id"], "timestamp": e.get("timestamp"),
           "sessionId": e.get("sessionId"), "kind": e.get("kind"),
           "provider": e.get("provider", "test")}
    payload = e.get("payload") or {}
    new_payload = {}
    for k in ("tool_name","agentId","toolUseId","text","body","title",
              "description","question","header","chosen","content",
              "attributionAgent"):
        if k in payload:
            v = payload[k]
            if isinstance(v, str) and len(v) > 60: v = v[:60] + "..."
            new_payload[k] = v
    raw = payload.get("raw")
    if isinstance(raw, dict):
        new_raw = {}
        for k in ("agent_id","tool_use_id","tool_name"):
            if k in raw: new_raw[k] = raw[k]
        ti = raw.get("tool_input")
        if isinstance(ti, dict):
            new_ti = {}
            for k in ("file_path","path","notebook_path"):
                if k in ti:
                    v = ti[k]
                    if isinstance(v, str) and len(v) > 60: v = v[:60] + "..."
                    new_ti[k] = v
            if new_ti: new_raw["tool_input"] = new_ti
        if new_raw: new_payload["raw"] = new_raw
    if new_payload: out["payload"] = new_payload
    meta = e.get("meta")
    if isinstance(meta, dict):
        new_meta = {k: meta[k] for k in ("subagentId","hook") if k in meta}
        if new_meta: out["meta"] = new_meta
    return out

with open("logbook/evidence/events.jsonl") as f, \
     open("tests/fixtures/real-events-narrative.jsonl","w") as out:
    n = 0
    for line in f:
        line = line.rstrip("\n")
        if not line: continue
        try: e = json.loads(line)
        except: continue
        if e.get("sessionId") != "ed7da74b-a9c0-4b84-aa3d-098329172696":
            continue
        if e.get("kind") == "hook_event": continue
        n += 1
        if not ((n <= 600) or (n > 1000 and n <= 1500)): continue
        out.write(json.dumps(minify(e), separators=(",",":")) + "\n")
PY
```

Coverage (verified at generation time):

| kind              | count |
| ----------------- | ----: |
| user_prompt       |    19 |
| claude_message    |    86 |
| subagent_complete |    22 |
| agent_question    |     6 |
| tool_result       |   947 |
| system            |    20 |

Plus 165 direct (non-sub-agent) `tool_result` events that carry a
`payload.raw.tool_input.file_path` — required by the `filesTouched` rollup
assertion.

## `real-events-ghost-turn.jsonl` (slice 21)

Derived from `real-events-narrative.jsonl` by removing every `claude_message`
to simulate a session captured on a machine where the transcript scraper did
not run.

```bash
jq -c 'select(.kind != "claude_message")' \
  tests/fixtures/real-events-narrative.jsonl \
  > tests/fixtures/real-events-ghost-turn.jsonl
```

Used by the ghost-turn detection test (R-87/R-89/INV).
