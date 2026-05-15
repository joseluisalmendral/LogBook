import { describe, it, expect } from "vitest";
import { DryRunContext, type DryRunPlannedOp } from "../../src/core/dryrun.js";

describe("DryRunContext.plan", () => {
  it("collects operations in order", () => {
    const ctx = new DryRunContext();
    const op1: DryRunPlannedOp = { kind: "mkdir", path: "/some/dir" };
    const op2: DryRunPlannedOp = { kind: "write_file", path: "/some/file.txt", bytes_added: 100 };
    const op3: DryRunPlannedOp = { kind: "remove_file", path: "/other/file.txt" };
    ctx.plan(op1);
    ctx.plan(op2);
    ctx.plan(op3);
    expect(ctx.operations).toHaveLength(3);
    expect(ctx.operations[0]).toEqual(op1);
    expect(ctx.operations[1]).toEqual(op2);
    expect(ctx.operations[2]).toEqual(op3);
  });

  it("starts with an empty operations list", () => {
    const ctx = new DryRunContext();
    expect(ctx.operations).toEqual([]);
  });
});

describe("DryRunContext.renderTable", () => {
  it("returns a string containing each operation kind and path", () => {
    const ctx = new DryRunContext();
    ctx.plan({ kind: "mkdir", path: "/foo/bar" });
    ctx.plan({ kind: "write_file", path: "/foo/file.ts", bytes_added: 42 });
    ctx.plan({ kind: "backup_file", src: "/foo/file.ts", dst: "/backups/file.ts" });
    ctx.plan({ kind: "remove_file", path: "/foo/old.ts" });
    const table = ctx.renderTable();
    expect(typeof table).toBe("string");
    expect(table).toContain("mkdir");
    expect(table).toContain("/foo/bar");
    expect(table).toContain("write_file");
    expect(table).toContain("/foo/file.ts");
    expect(table).toContain("backup_file");
    expect(table).toContain("remove_file");
    expect(table).toContain("/foo/old.ts");
  });

  it("returns an empty table string when there are no operations", () => {
    const ctx = new DryRunContext();
    const table = ctx.renderTable();
    expect(typeof table).toBe("string");
  });
});

describe("DryRunContext.renderJson", () => {
  it("returns valid JSON parseable to an array", () => {
    const ctx = new DryRunContext();
    ctx.plan({ kind: "mkdir", path: "/x" });
    ctx.plan({ kind: "remove_file", path: "/y" });
    const json = ctx.renderJson();
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it("returns empty JSON array when there are no operations", () => {
    const ctx = new DryRunContext();
    expect(JSON.parse(ctx.renderJson())).toEqual([]);
  });
});
