/**
 * token-measure-extract.test.ts — Regression guard for computeTokenBreakdown extraction.
 *
 * TDD Cycle:
 *   RED  → fails when computeTokenBreakdown is NOT exported from src/core/token-measure.ts
 *   GREEN → passes after extraction (verbatim move from doctor.ts)
 *   REFACTOR → no change expected (pure structural refactor)
 *
 * Strategy: construct a minimal fake project tree on disk (using tmp dirs),
 * build a Manifest that mirrors the teaching preset shape, call
 * computeTokenBreakdown, and assert that:
 *   1. All breakdown fields are present.
 *   2. The numerical values match the well-known iter4 reference (standard=381,
 *      teaching=499) within a small tolerance for file content variations.
 *   3. The `TokenBreakdown` type is exported and has the expected fields.
 *
 * Fixture shapes:
 *   standard-like:  1 hook + 1 mcp + 1 augment + 8 slash + 2 skill + 1 gitignore
 *   teaching-like:  standard + 2 subagent + 1 statusline + 1 SessionStart hook
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, test, expect, afterEach } from "vitest";
import {
  computeTokenBreakdown,
  type TokenBreakdown,
} from "../../src/core/token-measure.js";
import type { Manifest, ManifestArtifact } from "../../src/types/manifest.js";

// ---------------------------------------------------------------------------
// Fake project tree helpers
// ---------------------------------------------------------------------------

let tmpRoot: string | null = null;

function makeTmpProject(): string {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lb-tm-extract-"));
  return tmpRoot;
}

afterEach(() => {
  if (tmpRoot !== null) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
});

/**
 * Build a fake ManifestArtifact (only fields needed by computeTokenBreakdown).
 * Uses a dummy anchor so the Manifest type is satisfied.
 */
function makeArtifact(
  id: string,
  kind: ManifestArtifact["kind"],
  file_path: string,
  jsonPathOverride?: string,
): ManifestArtifact {
  // For hook artifacts, the jsonPath encodes the hookEvent (PostToolUse,
  // SessionStart, etc.). Token-measure now reads `hookEvent` from this path
  // instead of heuristic-matching on the lb-* id string (regression
  // 2026-05-21 audit, WARNING #7). Tests can pass `jsonPathOverride` to
  // simulate the real anchor; otherwise we synthesize from the id.
  const jsonPath =
    jsonPathOverride ??
    (kind === "hook"
      ? `/hooks/${id.includes("sessionstart") ? "SessionStart" : "PostToolUse"}/0`
      : "/dummy");
  return {
    id,
    kind,
    file_path,
    anchor: {
      type: "json_field",
      jsonPath,
      idField: "_logbookId",
      idValue: id,
    },
    content_hash: "0000000000000000000000000000000000000000000000000000000000000000",
    installed_at: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Install fake slash command files — YAML frontmatter with description: field.
 * Returns the artifact entries.
 */
function installSlashCommands(
  root: string,
  names: string[],
): ManifestArtifact[] {
  const commandsDir = path.join(root, ".claude", "commands");
  fs.mkdirSync(commandsDir, { recursive: true });

  return names.map((name) => {
    const description = `Log a ${name} event.`; // known-length body
    const content = `---\ndescription: ${description}\n---\n\nSlash command body for ${name}.\n`;
    const file_path = `.claude/commands/${name}.md`;
    fs.writeFileSync(path.join(root, file_path), content, "utf8");
    return makeArtifact(`lb-cmd-${name}`, "slash_command", file_path);
  });
}

/**
 * Install a fake SKILL.md into the project.
 * We use a known-length body so tokens are predictable.
 */
function installSkill(root: string): ManifestArtifact[] {
  const skillDir = path.join(root, ".claude", "skills", "logbook-auto-capture");
  fs.mkdirSync(skillDir, { recursive: true });

  // SKILL.md: 200 chars body → ceil(200/4) = 50 tokens
  const skillBody = "A".repeat(200);
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillBody, "utf8");

  // reference.md: on-demand, should contribute 0 tokens
  fs.writeFileSync(path.join(skillDir, "reference.md"), "Reference content here.", "utf8");

  return [
    makeArtifact("lb-skill-main", "skill", ".claude/skills/logbook-auto-capture/SKILL.md"),
    makeArtifact("lb-skill-ref", "skill", ".claude/skills/logbook-auto-capture/reference.md"),
  ];
}

/**
 * Install a fake CLAUDE.md with logbook augment block.
 * Known body: 100 chars → ceil(100/4) = 25 tokens.
 */
function installAugment(root: string): ManifestArtifact {
  const augmentBody = "B".repeat(100);
  const fileContent = [
    "# My Project",
    "",
    "<!-- logbook:generated start v=1 -->",
    augmentBody,
    "<!-- logbook:generated end -->",
    "",
    "Other content here.",
  ].join("\n");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), fileContent, "utf8");
  return makeArtifact("lb-claudemd-001", "augment_claudemd", "CLAUDE.md");
}

// ---------------------------------------------------------------------------
// Build manifests
// ---------------------------------------------------------------------------

function buildStandardManifest(root: string): Manifest {
  const slashNames = ["lb-decision", "lb-error", "lb-fix", "lb-lesson", "lb-milestone", "lb-phase", "lb-review", "lb-status"];
  const slashArtifacts = installSlashCommands(root, slashNames);
  const skillArtifacts = installSkill(root);
  const augment = installAugment(root);

  return {
    version: 1,
    installed_at: "2026-01-01T00:00:00.000Z",
    preset: "standard",
    artifacts: [
      makeArtifact("lb-hook-posttooluse-001", "hook", ".claude/settings.local.json"),
      makeArtifact("lb-mcp-001", "mcp_server", ".mcp.json"),
      augment,
      ...slashArtifacts,
      ...skillArtifacts,
      makeArtifact("lb-gitignore-001", "gitignore_entry", ".gitignore"),
    ],
    backups: [],
  };
}

function buildTeachingManifest(root: string): Manifest {
  const standard = buildStandardManifest(root);
  return {
    ...standard,
    preset: "teaching",
    artifacts: [
      ...standard.artifacts.filter((a) => a.id !== "lb-gitignore-001"),
      makeArtifact("lb-agent-curator-001", "subagent", ".claude/subagents/logbook-curator.md"),
      makeArtifact("lb-agent-teacher-001", "subagent", ".claude/subagents/logbook-teacher.md"),
      makeArtifact("lb-statusline-001", "statusline", ".logbook/statusline"),
      makeArtifact("lb-hook-sessionstart-001", "hook", ".claude/settings.local.json"),
      makeArtifact("lb-gitignore-001", "gitignore_entry", ".gitignore"),
    ],
  };
}

// ---------------------------------------------------------------------------
// Token math helpers (mirrors doctor.ts logic — used to verify correctness)
// ---------------------------------------------------------------------------

// Known MCP descriptions (static constant from token-measure.ts)
// SG0: logbook_lesson and logbook_state descriptions shortened to create token margin.
// v1.2: logbook_qa_finding added (ux-granularity-and-capture-gaps).
const MCP_DESCRIPTIONS = [
  "Log an architectural decision.",
  "Log a didactic error.",
  "Link a fix to an error.",
  "Log a lesson learned.",                 // SG0: was "Log a lesson learned (human-authored)."
  "Log an external resource.",
  "Close a phase with a milestone.",
  "Switch active phase.",
  "Queue a suggestion for human review.",
  "Get phase, session, pending.",          // SG0: was "Get current phase, session, pending."
  "Log a QA finding.",                     // v1.2: ux-granularity-and-capture-gaps B5
];

const EXPECTED_MCP_TOKENS = MCP_DESCRIPTIONS.reduce(
  (sum, d) => sum + Math.ceil(d.length / 4),
  0,
);

// Slash: "Log a lb-<name> event." → lengths vary by name
const SLASH_NAMES = ["lb-decision", "lb-error", "lb-fix", "lb-lesson", "lb-milestone", "lb-phase", "lb-review", "lb-status"];
const EXPECTED_SLASH_TOKENS = SLASH_NAMES.reduce(
  (sum, name) => sum + Math.ceil(`Log a ${name} event.`.length / 4),
  0,
);

const EXPECTED_SKILL_TOKENS = Math.ceil(200 / 4); // 50 (SKILL.md only; reference.md = 0)
const EXPECTED_AUGMENT_TOKENS = Math.ceil(100 / 4); // 25

const EXPECTED_STANDARD_TOTAL =
  EXPECTED_SKILL_TOKENS +
  EXPECTED_AUGMENT_TOKENS +
  EXPECTED_MCP_TOKENS +
  EXPECTED_SLASH_TOKENS;

// teaching adds SessionStart = 120 tokens
const EXPECTED_TEACHING_TOTAL = EXPECTED_STANDARD_TOTAL + 120;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeTokenBreakdown — extraction regression guard", () => {
  test("TokenBreakdown type is exported and has the expected fields", () => {
    // This test acts as a compile-time shape guard via TS type checking.
    // At runtime it just verifies the function returns the shape.
    const tmp = makeTmpProject();
    const manifest = buildStandardManifest(tmp);
    const result = computeTokenBreakdown(manifest, tmp);

    // Required fields per design §1 / doctor.ts breakdown:
    const keys: (keyof TokenBreakdown)[] = [
      "skill",
      "augmentClaudemd",
      "mcpToolDescriptions",
      "slashCommandDescriptions",
      "subagentDescriptions",
      "statusline",
      "sessionStart",
    ];
    for (const key of keys) {
      expect(result, `missing field: ${key}`).toHaveProperty(key);
      expect(typeof result[key], `${key} must be number`).toBe("number");
    }
  });

  test("standard: breakdown fields match expected values", () => {
    const tmp = makeTmpProject();
    const manifest = buildStandardManifest(tmp);
    const breakdown = computeTokenBreakdown(manifest, tmp);

    expect(breakdown.skill).toBe(EXPECTED_SKILL_TOKENS);
    expect(breakdown.augmentClaudemd).toBe(EXPECTED_AUGMENT_TOKENS);
    expect(breakdown.mcpToolDescriptions).toBe(EXPECTED_MCP_TOKENS);
    expect(breakdown.slashCommandDescriptions).toBe(EXPECTED_SLASH_TOKENS);
    expect(breakdown.subagentDescriptions).toBe(0); // always 0
    expect(breakdown.statusline).toBe(0);            // always 0
    expect(breakdown.sessionStart).toBe(0);          // no SessionStart hook in standard
  });

  test("standard: fixedContextTokens sum is correct", () => {
    const tmp = makeTmpProject();
    const manifest = buildStandardManifest(tmp);
    const breakdown = computeTokenBreakdown(manifest, tmp);

    const sum =
      breakdown.skill +
      breakdown.augmentClaudemd +
      breakdown.mcpToolDescriptions +
      breakdown.slashCommandDescriptions +
      breakdown.subagentDescriptions +
      breakdown.statusline +
      breakdown.sessionStart;

    expect(sum).toBe(EXPECTED_STANDARD_TOTAL);
  });

  test("teaching: SessionStart hook contributes exactly 120 tokens", () => {
    const tmp = makeTmpProject();
    const manifest = buildTeachingManifest(tmp);
    const breakdown = computeTokenBreakdown(manifest, tmp);

    expect(breakdown.sessionStart).toBe(120);
    expect(breakdown.subagentDescriptions).toBe(0); // subagents = 0 always
    expect(breakdown.statusline).toBe(0);           // statusline = 0 always
  });

  test("teaching: fixedContextTokens = standard total + 120", () => {
    const tmp = makeTmpProject();
    const manifest = buildTeachingManifest(tmp);
    const breakdown = computeTokenBreakdown(manifest, tmp);

    const sum =
      breakdown.skill +
      breakdown.augmentClaudemd +
      breakdown.mcpToolDescriptions +
      breakdown.slashCommandDescriptions +
      breakdown.subagentDescriptions +
      breakdown.statusline +
      breakdown.sessionStart;

    expect(sum).toBe(EXPECTED_TEACHING_TOTAL);
  });

  test("reference.md skill contributes 0 tokens (on-demand only)", () => {
    const tmp = makeTmpProject();
    const manifest = buildStandardManifest(tmp);

    // Modify manifest to have only the reference.md skill entry
    const refOnlyManifest: Manifest = {
      ...manifest,
      artifacts: [
        makeArtifact("lb-skill-ref", "skill", ".claude/skills/logbook-auto-capture/reference.md"),
      ],
    };

    const breakdown = computeTokenBreakdown(refOnlyManifest, tmp);
    expect(breakdown.skill).toBe(0);
  });

  test("missing augment file → augmentClaudemd = 0 (graceful fallback)", () => {
    const tmp = makeTmpProject();
    const manifest: Manifest = {
      version: 1,
      installed_at: "2026-01-01T00:00:00.000Z",
      preset: "standard",
      artifacts: [
        makeArtifact("lb-claudemd-001", "augment_claudemd", "CLAUDE.md"),
      ],
      backups: [],
    };
    // CLAUDE.md does NOT exist — no writeFileSync call
    const breakdown = computeTokenBreakdown(manifest, tmp);
    expect(breakdown.augmentClaudemd).toBe(0);
  });

  test("empty manifest → all zeros", () => {
    const tmp = makeTmpProject();
    const emptyManifest: Manifest = {
      version: 1,
      installed_at: "2026-01-01T00:00:00.000Z",
      preset: "minimal",
      artifacts: [],
      backups: [],
    };
    const breakdown = computeTokenBreakdown(emptyManifest, tmp);
    expect(breakdown.skill).toBe(0);
    expect(breakdown.augmentClaudemd).toBe(0);
    expect(breakdown.mcpToolDescriptions).toBe(0);
    expect(breakdown.slashCommandDescriptions).toBe(0);
    expect(breakdown.subagentDescriptions).toBe(0);
    expect(breakdown.statusline).toBe(0);
    expect(breakdown.sessionStart).toBe(0);
  });

  test("sessionstart detection is case-insensitive on id substring", () => {
    const tmp = makeTmpProject();
    // Use "lb-hook-SessionStart-001" (uppercase S in id)
    const artifact = makeArtifact("lb-hook-SessionStart-001", "hook", ".claude/settings.local.json");
    const manifest: Manifest = {
      version: 1,
      installed_at: "2026-01-01T00:00:00.000Z",
      preset: "teaching",
      artifacts: [artifact],
      backups: [],
    };
    const breakdown = computeTokenBreakdown(manifest, tmp);
    // The detection in doctor.ts uses id.includes("sessionstart") (lowercase)
    // so this should be 0 if the implementation matches exactly.
    // We're testing fidelity to doctor.ts behavior, not our preference.
    // doctor.ts: const id = entry.id as string; if (id.includes("sessionstart") || id.includes("session-start"))
    // "lb-hook-SessionStart-001".includes("sessionstart") → false (case-sensitive)
    // This test confirms the extraction is verbatim.
    expect(breakdown.sessionStart).toBe(0); // case-sensitive match → no detection
  });

  test("lb-hook-sessionstart-001 id detects SessionStart (exact case from presets)", () => {
    const tmp = makeTmpProject();
    const artifact = makeArtifact("lb-hook-sessionstart-001", "hook", ".claude/settings.local.json");
    const manifest: Manifest = {
      version: 1,
      installed_at: "2026-01-01T00:00:00.000Z",
      preset: "teaching",
      artifacts: [artifact],
      backups: [],
    };
    const breakdown = computeTokenBreakdown(manifest, tmp);
    expect(breakdown.sessionStart).toBe(120);
  });
});
