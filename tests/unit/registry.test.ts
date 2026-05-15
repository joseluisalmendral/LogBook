import { describe, it, expect, beforeEach } from "vitest";
import {
  register,
  getInstaller,
  listRegistered,
  clearRegistry,
} from "../../src/connectors/claude-code/artifacts/registry.js";
import type { ArtifactInstaller } from "../../src/connectors/claude-code/artifacts/installer.js";
import type { Artifact } from "../../src/types/artifact.js";
import type { ManifestArtifact } from "../../src/types/manifest.js";

// ---------------------------------------------------------------------------
// Minimal FakeInstaller for testing the registry mechanics only
// ---------------------------------------------------------------------------

function makeFakeInstaller(kind: ArtifactInstaller["kind"]): ArtifactInstaller {
  return {
    kind,
    detect: async () => ({ status: "empty" as const }),
    install: async (_artifact: Artifact, _ctx: unknown) =>
      ({ id: "fake-001" }) as unknown as ManifestArtifact,
    uninstall: async () => {},
    verify: async () => ({ ok: true }),
  };
}

// Clear registry before every test to keep tests independent.
beforeEach(() => {
  clearRegistry();
});

describe("register + getInstaller", () => {
  it("registers an installer and retrieves it by kind", () => {
    const installer = makeFakeInstaller("hook");
    register(installer);
    expect(getInstaller("hook")).toBe(installer);
  });

  it("throws when registering the same kind twice", () => {
    register(makeFakeInstaller("hook"));
    expect(() => register(makeFakeInstaller("hook"))).toThrow(
      /already registered/
    );
  });

  it("throws with the kind name in the error message", () => {
    register(makeFakeInstaller("gitignore_entry"));
    expect(() => register(makeFakeInstaller("gitignore_entry"))).toThrow("gitignore_entry");
  });
});

describe("getInstaller", () => {
  it("throws when no installer is registered for a kind", () => {
    expect(() => getInstaller("hook")).toThrow(/No installer registered/);
  });

  it("includes the kind in the error message", () => {
    expect(() => getInstaller("skill")).toThrow("skill");
  });
});

describe("listRegistered", () => {
  it("returns empty array when no installers are registered", () => {
    expect(listRegistered()).toEqual([]);
  });

  it("returns registered kinds in insertion order", () => {
    register(makeFakeInstaller("hook"));
    register(makeFakeInstaller("gitignore_entry"));
    const kinds = listRegistered();
    expect(kinds).toContain("hook");
    expect(kinds).toContain("gitignore_entry");
    expect(kinds).toHaveLength(2);
  });
});

describe("clearRegistry", () => {
  it("empties the registry so previously registered installers cannot be retrieved", () => {
    register(makeFakeInstaller("hook"));
    clearRegistry();
    expect(() => getInstaller("hook")).toThrow();
    expect(listRegistered()).toHaveLength(0);
  });
});
