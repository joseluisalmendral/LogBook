/**
 * Narrative-kinds sync test (slice 21 / INV-20 / ADR-SN-A1).
 *
 * Enforces byte-for-byte equality between:
 *   - src/types/narrative-kinds.ts         (backend source of truth)
 *   - apps/export-ui/src/lib/types/narrative-kinds.ts  (UI hand-copy)
 *
 * If this test fails, copy src/types/narrative-kinds.ts contents to
 * apps/export-ui/src/lib/types/narrative-kinds.ts to fix this.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("narrative-kinds sync (INV-20)", () => {
  it("backend and export-ui copies are byte-identical", () => {
    const root = resolve(__dirname, "../..");
    const backendPath = resolve(root, "src/types/narrative-kinds.ts");
    const uiPath = resolve(
      root,
      "apps/export-ui/src/lib/types/narrative-kinds.ts",
    );
    const backend = readFileSync(backendPath, "utf8");
    const ui = readFileSync(uiPath, "utf8");
    expect(
      ui,
      "Copy src/types/narrative-kinds.ts contents to apps/export-ui/src/lib/types/narrative-kinds.ts to fix this.",
    ).toBe(backend);
  });
});
