import { describe, it, expect } from "vitest";
import { scanForAnchor, findExistingLogbookEntry } from "../../src/core/detect.js";
import { sha256 } from "../../src/util/hash.js";
import type { AnchorSpec, ManifestArtifact, Manifest } from "../../src/types/manifest.js";

// ---------------------------------------------------------------------------
// Helpers to build sample manifest entries
// ---------------------------------------------------------------------------

function makeManifest(artifacts: ManifestArtifact[]): Manifest {
  return {
    version: 1,
    installed_at: "2026-01-01T00:00:00Z",
    preset: "minimal",
    artifacts,
    backups: [],
  };
}

function makeArtifact(
  id: string,
  kind: ManifestArtifact["kind"],
  file_path: string,
  anchor: AnchorSpec
): ManifestArtifact {
  return { id, kind, file_path, anchor, content_hash: "abc", installed_at: "2026-01-01T00:00:00Z" };
}

// ---------------------------------------------------------------------------
// scanForAnchor — json_field variant
// ---------------------------------------------------------------------------

describe("scanForAnchor — json_field", () => {
  const anchor: AnchorSpec = {
    type: "json_field",
    jsonPath: "/hooks/PostToolUse/0",
    idField: "_logbookId",
    idValue: "lb-hook-001",
  };

  it("returns present:true when the idField:idValue pair is found", () => {
    const content = JSON.stringify(
      { hooks: { PostToolUse: [{ command: "node hook.cjs", _logbookId: "lb-hook-001" }] } },
      null,
      2
    );
    // Content hash matches sha256 of the stringified entry object
    const entryText = JSON.stringify({ command: "node hook.cjs", _logbookId: "lb-hook-001" });
    const hash = sha256(entryText);
    const result = scanForAnchor(content, anchor, hash);
    expect(result.present).toBe(true);
  });

  it("returns present:false when idValue is not found in file", () => {
    const content = JSON.stringify({ hooks: { PostToolUse: [] } }, null, 2);
    const result = scanForAnchor(content, anchor, "any-hash");
    expect(result.present).toBe(false);
    expect(result.contentMatchesHash).toBe(false);
  });

  it("returns contentMatchesHash:false when id found but hash differs", () => {
    const content = JSON.stringify(
      { hooks: { PostToolUse: [{ command: "node hook.cjs", _logbookId: "lb-hook-001" }] } },
      null,
      2
    );
    const result = scanForAnchor(content, anchor, "wrong-hash");
    expect(result.present).toBe(true);
    expect(result.contentMatchesHash).toBe(false);
  });

  it("returns present:false for wrong idValue even when field exists", () => {
    const content = JSON.stringify(
      { hooks: { PostToolUse: [{ _logbookId: "lb-hook-002" }] } },
      null,
      2
    );
    const result = scanForAnchor(content, anchor, "any");
    expect(result.present).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanForAnchor — markdown_block variant
// ---------------------------------------------------------------------------

describe("scanForAnchor — markdown_block", () => {
  const anchor: AnchorSpec = {
    type: "markdown_block",
    start_marker: "<!-- logbook:generated start v=1 -->",
    end_marker: "<!-- logbook:generated end -->",
  };

  it("returns present:true when exactly one block is found", () => {
    const blockContent = "some generated content";
    const full = `<!-- logbook:generated start v=1 -->\n${blockContent}\n<!-- logbook:generated end -->`;
    const hash = sha256(full);
    const result = scanForAnchor(full, anchor, hash);
    expect(result.present).toBe(true);
    expect(result.contentMatchesHash).toBe(true);
  });

  it("returns present:false when no block is found", () => {
    const content = "# No logbook block here\n";
    const result = scanForAnchor(content, anchor, "any");
    expect(result.present).toBe(false);
    expect(result.contentMatchesHash).toBe(false);
  });

  it("returns present:false (ambiguous) when two blocks found", () => {
    const block = "<!-- logbook:generated start v=1 -->\ncontent\n<!-- logbook:generated end -->";
    const content = `${block}\n\n${block}`;
    const result = scanForAnchor(content, anchor, "any");
    expect(result.present).toBe(false);
  });

  it("returns contentMatchesHash:false when block found but hash differs", () => {
    const full = "<!-- logbook:generated start v=1 -->\nfoo\n<!-- logbook:generated end -->";
    const result = scanForAnchor(full, anchor, "wrong-hash");
    expect(result.present).toBe(true);
    expect(result.contentMatchesHash).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanForAnchor — line_set variant
// ---------------------------------------------------------------------------

describe("scanForAnchor — line_set", () => {
  const lines = ["", ".logbook/", "logbook/", "# lb-gitignore-001"];
  const anchor: AnchorSpec = { type: "line_set", lines };

  it("returns present:true when all lines are found contiguously", () => {
    const blockStr = lines.join("\n");
    const content = `node_modules/\ndist/\n${blockStr}\n`;
    const hash = sha256(blockStr);
    const result = scanForAnchor(content, anchor, hash);
    expect(result.present).toBe(true);
    expect(result.contentMatchesHash).toBe(true);
  });

  it("returns present:false when lines are absent", () => {
    const content = "node_modules/\n";
    const result = scanForAnchor(content, anchor, "any");
    expect(result.present).toBe(false);
  });

  it("returns contentMatchesHash:false when lines found but hash differs", () => {
    const blockStr = lines.join("\n");
    const content = `${blockStr}\n`;
    const result = scanForAnchor(content, anchor, "wrong-hash");
    expect(result.present).toBe(true);
    expect(result.contentMatchesHash).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findExistingLogbookEntry
// ---------------------------------------------------------------------------

describe("findExistingLogbookEntry", () => {
  it("returns the matching ManifestArtifact for json_field anchor", () => {
    const anchor: AnchorSpec = {
      type: "json_field",
      jsonPath: "/hooks/PostToolUse/0",
      idField: "_logbookId",
      idValue: "lb-hook-001",
    };
    const artifact = makeArtifact("lb-hook-001", "hook", ".claude/settings.local.json", anchor);
    const manifest = makeManifest([artifact]);

    const result = findExistingLogbookEntry(manifest, ".claude/settings.local.json", anchor);
    expect(result).toBe(artifact);
  });

  it("returns null when file_path does not match", () => {
    const anchor: AnchorSpec = {
      type: "json_field",
      jsonPath: "/hooks/PostToolUse/0",
      idField: "_logbookId",
      idValue: "lb-hook-001",
    };
    const artifact = makeArtifact("lb-hook-001", "hook", ".claude/settings.local.json", anchor);
    const manifest = makeManifest([artifact]);

    const result = findExistingLogbookEntry(manifest, "other.json", anchor);
    expect(result).toBeNull();
  });

  it("returns null when idValue differs (json_field)", () => {
    const anchor: AnchorSpec = {
      type: "json_field",
      jsonPath: "/hooks/PostToolUse/0",
      idField: "_logbookId",
      idValue: "lb-hook-001",
    };
    const searchAnchor: AnchorSpec = {
      type: "json_field",
      jsonPath: "/hooks/PostToolUse/0",
      idField: "_logbookId",
      idValue: "lb-hook-002",
    };
    const artifact = makeArtifact("lb-hook-001", "hook", ".claude/settings.local.json", anchor);
    const manifest = makeManifest([artifact]);

    const result = findExistingLogbookEntry(manifest, ".claude/settings.local.json", searchAnchor);
    expect(result).toBeNull();
  });

  it("returns matching entry for markdown_block anchor (same markers)", () => {
    const anchor: AnchorSpec = {
      type: "markdown_block",
      start_marker: "<!-- logbook:generated start v=1 -->",
      end_marker: "<!-- logbook:generated end -->",
    };
    const artifact = makeArtifact("lb-aug-001", "augment_claudemd", "CLAUDE.md", anchor);
    const manifest = makeManifest([artifact]);

    const result = findExistingLogbookEntry(manifest, "CLAUDE.md", anchor);
    expect(result).toBe(artifact);
  });

  it("returns null for markdown_block anchor with different start_marker", () => {
    const anchor: AnchorSpec = {
      type: "markdown_block",
      start_marker: "<!-- logbook:generated start v=1 -->",
      end_marker: "<!-- logbook:generated end -->",
    };
    const searchAnchor: AnchorSpec = {
      type: "markdown_block",
      start_marker: "<!-- logbook:generated start v=2 -->",
      end_marker: "<!-- logbook:generated end -->",
    };
    const artifact = makeArtifact("lb-aug-001", "augment_claudemd", "CLAUDE.md", anchor);
    const manifest = makeManifest([artifact]);

    const result = findExistingLogbookEntry(manifest, "CLAUDE.md", searchAnchor);
    expect(result).toBeNull();
  });

  it("returns matching entry for line_set anchor (same lines)", () => {
    const lines = ["", ".logbook/", "logbook/"];
    const anchor: AnchorSpec = { type: "line_set", lines };
    const artifact = makeArtifact("lb-gitignore-001", "gitignore_entry", ".gitignore", anchor);
    const manifest = makeManifest([artifact]);

    const result = findExistingLogbookEntry(manifest, ".gitignore", anchor);
    expect(result).toBe(artifact);
  });

  it("returns null for line_set anchor with different lines content", () => {
    const anchor: AnchorSpec = { type: "line_set", lines: ["", ".logbook/"] };
    const searchAnchor: AnchorSpec = { type: "line_set", lines: ["", ".other/"] };
    const artifact = makeArtifact("lb-gitignore-001", "gitignore_entry", ".gitignore", anchor);
    const manifest = makeManifest([artifact]);

    const result = findExistingLogbookEntry(manifest, ".gitignore", searchAnchor);
    expect(result).toBeNull();
  });

  it("returns null when manifest has no artifacts", () => {
    const anchor: AnchorSpec = {
      type: "line_set",
      lines: [".logbook/"],
    };
    const manifest = makeManifest([]);
    const result = findExistingLogbookEntry(manifest, ".gitignore", anchor);
    expect(result).toBeNull();
  });
});
