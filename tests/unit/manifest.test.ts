import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  emptyManifest,
  readManifest,
  writeManifest,
  addArtifact,
  removeArtifactById,
  findArtifactById,
  addBackup,
} from "../../src/core/manifest.js";
import { LogBookError } from "../../src/core/errors.js";
import type { ManifestArtifact, BackupRef } from "../../src/types/manifest.js";

let tmpDir: string;
let canonicalTmp: string;
let manifestPath: string;

const sampleArtifact: ManifestArtifact = {
  id: "lb-hook-001",
  kind: "hook",
  file_path: ".claude/settings.local.json",
  anchor: {
    type: "json_field",
    jsonPath: "/hooks/PostToolUse/0",
    idField: "_logbookId",
    idValue: "lb-hook-001",
  },
  content_hash: "abc123",
  installed_at: "2026-01-01T00:00:00Z",
};

const sampleBackup: BackupRef = {
  file_path: ".claude/settings.local.json",
  backup_path: ".logbook/backups/abc123-settings.local.json",
  sha256: "abc123def456",
  taken_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-manifest-"));
  canonicalTmp = fs.realpathSync(tmpDir);
  manifestPath = path.join(canonicalTmp, "install-manifest.json");
});

afterEach(() => {
  fs.rmSync(canonicalTmp, { recursive: true, force: true });
});

describe("emptyManifest", () => {
  it("returns a v1 manifest with minimal preset", () => {
    const m = emptyManifest("minimal");
    expect(m.version).toBe(1);
    expect(m.preset).toBe("minimal");
    expect(m.artifacts).toEqual([]);
    expect(m.backups).toEqual([]);
    expect(typeof m.installed_at).toBe("string");
    expect(m.installed_at.length).toBeGreaterThan(0);
  });

  it("uses the provided preset", () => {
    expect(emptyManifest("standard").preset).toBe("standard");
    expect(emptyManifest("full").preset).toBe("full");
  });
});

describe("readManifest", () => {
  it("returns null when file does not exist", () => {
    expect(readManifest(manifestPath)).toBeNull();
  });

  it("throws MANIFEST_VERSION_UNSUPPORTED for version != 1", () => {
    fs.writeFileSync(manifestPath, JSON.stringify({ version: 99, preset: "minimal", artifacts: [], backups: [], installed_at: "x" }));
    let caught: unknown;
    try {
      readManifest(manifestPath);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LogBookError);
    expect((caught as LogBookError).code).toBe("MANIFEST_VERSION_UNSUPPORTED");
  });
});

describe("writeManifest + readManifest roundtrip", () => {
  it("preserves all fields after write-read cycle", () => {
    const m = emptyManifest("minimal");
    writeManifest(manifestPath, m);
    const loaded = readManifest(manifestPath);
    expect(loaded).toEqual(m);
  });

  it("creates parent directories if they don't exist", () => {
    const nested = path.join(canonicalTmp, "deep", "dir", "manifest.json");
    const m = emptyManifest("minimal");
    writeManifest(nested, m);
    expect(readManifest(nested)).toEqual(m);
  });
});

describe("addArtifact", () => {
  it("returns a NEW manifest with one more artifact", () => {
    const m = emptyManifest("minimal");
    const m2 = addArtifact(m, sampleArtifact);
    expect(m2.artifacts).toHaveLength(1);
    expect(m2.artifacts[0]).toEqual(sampleArtifact);
    // Original is unchanged
    expect(m.artifacts).toHaveLength(0);
  });

  it("can add multiple artifacts", () => {
    let m = emptyManifest("minimal");
    const a1 = { ...sampleArtifact, id: "lb-001" };
    const a2 = { ...sampleArtifact, id: "lb-002" };
    m = addArtifact(m, a1);
    m = addArtifact(m, a2);
    expect(m.artifacts).toHaveLength(2);
  });
});

describe("removeArtifactById", () => {
  it("returns a NEW manifest without the artifact", () => {
    const m = addArtifact(emptyManifest("minimal"), sampleArtifact);
    const m2 = removeArtifactById(m, sampleArtifact.id);
    expect(m2.artifacts).toHaveLength(0);
    // Original is unchanged
    expect(m.artifacts).toHaveLength(1);
  });

  it("is a no-op when the id is not found", () => {
    const m = addArtifact(emptyManifest("minimal"), sampleArtifact);
    const m2 = removeArtifactById(m, "nonexistent");
    expect(m2.artifacts).toHaveLength(1);
  });
});

describe("findArtifactById", () => {
  it("returns the artifact when found", () => {
    const m = addArtifact(emptyManifest("minimal"), sampleArtifact);
    expect(findArtifactById(m, sampleArtifact.id)).toEqual(sampleArtifact);
  });

  it("returns null when not found", () => {
    const m = emptyManifest("minimal");
    expect(findArtifactById(m, "nonexistent")).toBeNull();
  });
});

describe("addBackup", () => {
  it("returns a NEW manifest with one more backup", () => {
    const m = emptyManifest("minimal");
    const m2 = addBackup(m, sampleBackup);
    expect(m2.backups).toHaveLength(1);
    expect(m2.backups[0]).toEqual(sampleBackup);
    // Original is unchanged
    expect(m.backups).toHaveLength(0);
  });
});
