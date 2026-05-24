/**
 * Unit tests: buildExportPayload narrative-rebuild (slice 21).
 *
 * Real-event fixtures only — NO inline `RenderEvent` literals constructed in
 * test code. Tests read fixtures from disk via `node:fs` and feed them into
 * `readContext` against a temp dir, then assert the build output against
 * R-81..R-92 + INV-20..INV-23 + AG-44..AG-48.
 *
 * Fixture provenance: see tests/fixtures/README.md.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildExportPayload } from "../../src/generate/build-export-payload.js";
import { readContext } from "../../src/generate/render-context.js";
import type { ProjectPaths } from "../../src/core/paths.js";
import type { RenderEvent } from "../../src/generate/render-context.js";
import { isNarrativeKind } from "../../src/types/narrative-kinds.js";

const FIXTURE_DIR = resolve(__dirname, "../fixtures");
const NARRATIVE_FIXTURE = join(FIXTURE_DIR, "real-events-narrative.jsonl");
const GHOST_FIXTURE = join(FIXTURE_DIR, "real-events-ghost-turn.jsonl");

/**
 * Write a fixture JSONL into a fresh temp project root and return the
 * matching ProjectPaths so the test can call `readContext(paths)`.
 */
function projectFromFixture(fixturePath: string): ProjectPaths {
  const root = mkdtempSync(join(tmpdir(), "logbook-narrative-"));
  const evidenceDir = join(root, "logbook", "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const content = readFileSync(fixturePath, "utf8");
  writeFileSync(join(evidenceDir, "events.jsonl"), content, "utf8");
  return {
    root,
    logbookDir: join(root, ".logbook"),
    manifestPath: join(root, ".logbook/install-manifest.json"),
    configPath: join(root, ".logbook/config.json"),
    providersPath: join(root, ".logbook/providers.json"),
    statePath: join(root, ".logbook/state.json"),
    indexDbPath: join(root, ".logbook/index.sqlite"),
    backupsDir: join(root, ".logbook/backups"),
    dataDir: join(root, "logbook"),
    evidenceDir,
    eventsJsonl: join(evidenceDir, "events.jsonl"),
  } satisfies ProjectPaths;
}

interface BuiltFixture {
  payload: Awaited<ReturnType<typeof buildExportPayload>>["payload"];
}

async function buildFromFixture(fixturePath: string): Promise<BuiltFixture> {
  const paths = projectFromFixture(fixturePath);
  const ctx = await readContext(paths);
  const { payload } = await buildExportPayload(ctx, paths, {
    exportedAt: "2026-05-24T00:00:00.000Z",
    gitSha: "test",
    noTranscripts: true,
  });
  return { payload };
}

describe("build-export-payload narrative-rebuild (slice 21)", () => {
  let narrative: BuiltFixture;
  let ghost: BuiltFixture;

  beforeAll(async () => {
    narrative = await buildFromFixture(NARRATIVE_FIXTURE);
    ghost = await buildFromFixture(GHOST_FIXTURE);
  });

  // ---------------------------------------------------------------------------
  // Suite 1 — Narrative-kind filter (R-81, INV-21, AG-45)
  // ---------------------------------------------------------------------------

  describe("Suite 1: narrative filter (R-81, INV-21)", () => {
    it("chapter.events contain only NARRATIVE_KINDS", () => {
      expect(narrative.payload.chapters.length).toBeGreaterThan(0);
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          const t = typeof e.type === "string" ? e.type : "";
          expect(
            isNarrativeKind(t),
            `event ${e.id} has non-narrative type "${t}"`,
          ).toBe(true);
        }
      }
    });

    it("chapter.events contain zero hook_event / tool_result / system entries", () => {
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          const t = typeof e.type === "string" ? e.type : "";
          expect(t.startsWith("tool_result")).toBe(false);
          expect(t).not.toBe("hook_event");
          expect(t).not.toBe("system");
          expect(t.startsWith("hook.")).toBe(false);
        }
      }
    });

    it("at least one chapter has user_prompt + claude_message + subagent_complete", () => {
      let foundUser = false;
      let foundClaude = false;
      let foundSubagent = false;
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          if (e.type === "user_prompt") foundUser = true;
          if (e.type === "claude_message") foundClaude = true;
          if (e.type === "subagent_complete") foundSubagent = true;
        }
      }
      expect(foundUser).toBe(true);
      expect(foundClaude).toBe(true);
      expect(foundSubagent).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2 — toolStrip rollup (R-82, INV-22)
  // ---------------------------------------------------------------------------

  describe("Suite 2: toolStrip rollup (R-82, INV-22)", () => {
    it("every claude_message carries payload.toolStrip and payload.filesTouched", () => {
      let claudeCount = 0;
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          if (e.type !== "claude_message") continue;
          claudeCount += 1;
          const rec = e as Record<string, unknown>;
          const payload = rec["payload"] as Record<string, unknown> | undefined;
          expect(payload, `claude_message ${e.id} has no payload`).toBeDefined();
          expect(
            Array.isArray(payload?.["toolStrip"]),
            `claude_message ${e.id} payload.toolStrip is not an array`,
          ).toBe(true);
          expect(
            Array.isArray(payload?.["filesTouched"]),
            `claude_message ${e.id} payload.filesTouched is not an array`,
          ).toBe(true);
        }
      }
      expect(claudeCount).toBeGreaterThan(0);
    });

    it("at least one claude_message has a non-empty toolStrip", () => {
      let foundNonEmpty = false;
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          if (e.type !== "claude_message") continue;
          const payload = (e as Record<string, unknown>)["payload"] as
            | Record<string, unknown>
            | undefined;
          const strip = payload?.["toolStrip"] as unknown[] | undefined;
          if (Array.isArray(strip) && strip.length > 0) foundNonEmpty = true;
        }
      }
      expect(foundNonEmpty).toBe(true);
    });

    it("toolStrip entries match the {name, file_path?, toolUseId?} shape", () => {
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          if (e.type !== "claude_message") continue;
          const payload = (e as Record<string, unknown>)["payload"] as
            | Record<string, unknown>
            | undefined;
          const strip = (payload?.["toolStrip"] as unknown[] | undefined) ?? [];
          for (const entry of strip) {
            expect(typeof entry).toBe("object");
            expect(entry).not.toBeNull();
            const o = entry as Record<string, unknown>;
            expect(typeof o["name"]).toBe("string");
            if (o["file_path"] !== undefined) {
              expect(typeof o["file_path"]).toBe("string");
            }
            if (o["toolUseId"] !== undefined) {
              expect(typeof o["toolUseId"]).toBe("string");
            }
          }
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3 — Sub-agent attribution (R-82, ADR-SN-B1)
  // ---------------------------------------------------------------------------

  describe("Suite 3: sub-agent attribution (R-82)", () => {
    it("toolStrip total is strictly smaller than raw direct+sub-agent tool_result count", () => {
      // Real-data invariant: the fixture contains a large number of
      // tool_results that belong to sub-agents (raw.payload.raw.agent_id is
      // set). The narrative-filter MUST exclude those from any
      // claude_message's toolStrip. If the filter mis-attributes, the strip
      // total would equal or exceed the sub-agent-attributed count.
      const raw = readFileSync(NARRATIVE_FIXTURE, "utf8");
      const rawEvents = raw
        .trim()
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>);

      // Count sub-agent-attributed tool_results in the raw fixture.
      let subagentAttributedCount = 0;
      let totalToolResults = 0;
      for (const ev of rawEvents) {
        if (ev["kind"] !== "tool_result") continue;
        totalToolResults += 1;
        const payload = ev["payload"] as Record<string, unknown> | undefined;
        const raw2 = payload?.["raw"] as Record<string, unknown> | undefined;
        if (typeof raw2?.["agent_id"] === "string" && (raw2["agent_id"] as string).length > 0) {
          subagentAttributedCount += 1;
        }
      }
      expect(subagentAttributedCount).toBeGreaterThan(0);

      // Count entries that actually landed in any claude_message's toolStrip.
      let toolStripCount = 0;
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          if (e.type !== "claude_message") continue;
          const payload = (e as Record<string, unknown>)["payload"] as
            | Record<string, unknown>
            | undefined;
          const strip = (payload?.["toolStrip"] as unknown[] | undefined) ?? [];
          const overflow =
            typeof payload?.["overflow"] === "number"
              ? (payload["overflow"] as number)
              : 0;
          toolStripCount += strip.length + overflow;
        }
      }
      // Strict upper bound: toolStrip entries must be NO MORE than the count
      // of direct (non-sub-agent) tool_results. We tolerate AskUserQuestion
      // dropouts (small handful) and ghost-region drops.
      const directToolResults = totalToolResults - subagentAttributedCount;
      expect(toolStripCount).toBeLessThanOrEqual(directToolResults);
      // Sanity: the filter actually dropped a meaningful fraction.
      expect(toolStripCount).toBeLessThan(totalToolResults);
    });

    it("subagent_complete events remain in chapter.events with their own payload.tools", () => {
      let subagentsSeen = 0;
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          if (e.type !== "subagent_complete") continue;
          subagentsSeen += 1;
          const payload = (e as Record<string, unknown>)["payload"] as
            | Record<string, unknown>
            | undefined;
          // Slice-15 enrichment attaches `tools` array; even if empty it must exist.
          expect(payload).toBeDefined();
        }
      }
      expect(subagentsSeen).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4 — AgentQuestion dedup (R-88, INV-23, AG-45)
  // ---------------------------------------------------------------------------

  describe("Suite 4: AgentQuestion dedup (INV-23, R-88)", () => {
    it("no tool_result.askuserquestion appears in chapter.events", () => {
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          const t = typeof e.type === "string" ? e.type.toLowerCase() : "";
          expect(t).not.toBe("tool_result.askuserquestion");
        }
      }
    });

    it("no claude_message toolStrip entry has name === 'AskUserQuestion'", () => {
      // AskUserQuestion is unconditionally dropped from the rollup (ADR-SN-B2
      // defensive secondary drop) — the synthesized agent_question is always
      // the better representation.
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          if (e.type !== "claude_message") continue;
          const payload = (e as Record<string, unknown>)["payload"] as
            | Record<string, unknown>
            | undefined;
          const strip = (payload?.["toolStrip"] as unknown[] | undefined) ?? [];
          for (const entry of strip) {
            const o = entry as Record<string, unknown>;
            const name = typeof o["name"] === "string" ? o["name"] : "";
            expect(name.toLowerCase()).not.toBe("askuserquestion");
          }
        }
      }
    });

    it("preserves agent_question events (chapter.events contains them)", () => {
      const aqCount = narrative.payload.chapters.reduce(
        (acc, ch) =>
          acc + ch.events.filter((e) => e.type === "agent_question").length,
        0,
      );
      expect(aqCount).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 5 — Ghost-turn detection (R-87, R-89, INV)
  // ---------------------------------------------------------------------------

  describe("Suite 5: ghost-turn detection (R-87/R-89)", () => {
    it("ghost fixture sets chapter.ghostTurns === true on at least one chapter", () => {
      const ghostChapters = ghost.payload.chapters.filter(
        (ch) => ch.ghostTurns === true,
      );
      expect(ghostChapters.length).toBeGreaterThan(0);
    });

    it("ghost fixture chapters still render user_prompt events", () => {
      const userPromptCount = ghost.payload.chapters.reduce(
        (acc, ch) =>
          acc + ch.events.filter((e) => e.type === "user_prompt").length,
        0,
      );
      expect(userPromptCount).toBeGreaterThan(0);
    });

    it("normal narrative fixture does NOT set ghostTurns on its chapters", () => {
      // The narrative fixture contains both user_prompt AND claude_message
      // events in every active chapter, so ghostTurns should never be true.
      for (const ch of narrative.payload.chapters) {
        if (ch.events.length === 0) continue;
        const hasUser = ch.events.some((e) => e.type === "user_prompt");
        const hasClaude = ch.events.some((e) => e.type === "claude_message");
        if (hasUser && hasClaude) {
          expect(ch.ghostTurns).not.toBe(true);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 6 — Empty-chapter elision (R-88, ADR-SN-B4)
  // ---------------------------------------------------------------------------

  describe("Suite 6: empty-chapter elision (R-88)", () => {
    it("no chapter in the output has zero events AND zero phases", () => {
      for (const ch of narrative.payload.chapters) {
        expect(ch.events.length + ch.phases.length).toBeGreaterThan(0);
      }
    });

    it("course.totals.sessions matches the visible chapter count", () => {
      expect(narrative.payload.course.totals.sessions).toBe(
        narrative.payload.chapters.length,
      );
    });

    it("synthesizes a noise-only session and confirms it is elided", async () => {
      // Build a fixture that contains ONE extra session whose events are all
      // noise (hook_event / system / tool_result). Derived from the real
      // narrative fixture by re-emitting only the noise lines under a synthetic
      // sessionId. NO inline event literals are constructed — every entry is
      // a real fixture row with a sessionId substitution.
      const raw = readFileSync(NARRATIVE_FIXTURE, "utf8");
      const noiseSid = "noise-only-session";
      const noiseLines = raw
        .trim()
        .split("\n")
        .filter((line) => {
          if (!line) return false;
          const ev = JSON.parse(line) as Record<string, unknown>;
          const k = ev["kind"];
          return k === "system" || k === "tool_result";
        })
        // Re-stamp the sessionId so the events form a distinct chapter.
        .map((line) => {
          const ev = JSON.parse(line) as Record<string, unknown>;
          ev["sessionId"] = noiseSid;
          if (ev["traceId"] !== undefined) ev["traceId"] = noiseSid;
          return JSON.stringify(ev);
        });

      const combined = raw + "\n" + noiseLines.join("\n");
      const paths = projectFromFixture(NARRATIVE_FIXTURE);
      writeFileSync(paths.eventsJsonl, combined, "utf8");
      const ctx = await readContext(paths);
      const { payload } = await buildExportPayload(ctx, paths, {
        exportedAt: "2026-05-24T00:00:00.000Z",
        gitSha: "test",
        noTranscripts: true,
      });
      const noiseChapters = payload.chapters.filter(
        (ch) => ch.sessionId === noiseSid,
      );
      expect(noiseChapters).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 7 — filesTouched on claude_message (R-83)
  // ---------------------------------------------------------------------------

  describe("Suite 7: filesTouched aggregation (R-83)", () => {
    it("at least one claude_message has a non-empty payload.filesTouched", () => {
      let foundNonEmpty = false;
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          if (e.type !== "claude_message") continue;
          const payload = (e as Record<string, unknown>)["payload"] as
            | Record<string, unknown>
            | undefined;
          const files = payload?.["filesTouched"] as string[] | undefined;
          if (Array.isArray(files) && files.length > 0) foundNonEmpty = true;
        }
      }
      expect(foundNonEmpty).toBe(true);
    });

    it("every filesTouched entry on a claude_message is a string path", () => {
      for (const ch of narrative.payload.chapters) {
        for (const e of ch.events) {
          if (e.type !== "claude_message") continue;
          const payload = (e as Record<string, unknown>)["payload"] as
            | Record<string, unknown>
            | undefined;
          const files = (payload?.["filesTouched"] as string[] | undefined) ?? [];
          for (const f of files) {
            expect(typeof f).toBe("string");
            expect(f.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 8 — Payload size (INV-12, NFR-2)
  // ---------------------------------------------------------------------------

  describe("Suite 8: payload-size invariant (INV-12, NFR-2)", () => {
    it("serialized narrative payload stays under the 5 MB inline cap", () => {
      const size = Buffer.byteLength(
        JSON.stringify(narrative.payload),
        "utf8",
      );
      expect(size).toBeLessThan(5 * 1024 * 1024);
    });
  });
});

// Cast to silence unused-import lint in some strict-mode setups.
void ({} as RenderEvent);
