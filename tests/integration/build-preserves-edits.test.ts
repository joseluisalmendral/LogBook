/**
 * Integration test: `logbook build` preserves user prose outside generated markers (T11).
 *
 * Pre-populates logbook/docs/index.md with user prose ABOVE the generated marker block,
 * runs `logbook build`, and asserts:
 *  - User prose above markers is byte-identical
 *  - Content inside markers is updated
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI = path.join(PROJECT_ROOT, "dist", "cli", "index.cjs");

beforeAll(() => {
  if (!fs.existsSync(CLI)) {
    const result = spawnSync("pnpm", ["build"], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`
      );
    }
  }
}, 90_000);

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-build-pre-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "docs"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" })
  );

  fs.writeFileSync(
    path.join(dir, ".logbook", "state.json"),
    JSON.stringify({ version: 1, disabled: false, warnings: [], staleLocksReleased: 0 }, null, 2) + "\n"
  );

  // Minimal events — one decision so docs have actual content
  const events = [
    { id: "D01", type: "manual.decision", ts: "2026-01-01T00:00:00.000Z", title: "Use JSONL", adrCounter: 1, status: "Accepted", chosen: "JSONL" },
  ];
  fs.writeFileSync(
    path.join(dir, "logbook", "evidence", "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8"
  );

  return dir;
}

function runCli(
  args: string[],
  cwd: string
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 30_000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("build-preserves-edits", () => {
  it("user prose ABOVE generated markers is preserved byte-for-byte", () => {
    const dir = makeTmpProject();
    const indexPath = path.join(dir, "logbook", "docs", "index.md");

    // Pre-populate with user prose ABOVE the generated block
    const userProse =
      "# My Project Notes\n\n" +
      "This section is written by the user and must not be touched by `logbook build`.\n\n" +
      "Additional paragraph with important project context.\n\n";

    fs.writeFileSync(indexPath, userProse, "utf8");

    const { code } = runCli(["build"], dir);
    expect(code).toBe(0);

    const after = fs.readFileSync(indexPath, "utf8");
    // User prose appears at the start, byte-identical
    expect(after.startsWith(userProse)).toBe(true);
    // Generated block is appended after the user prose
    expect(after).toContain("<!-- logbook:doc:index start v=1 -->");
  });

  it("content inside generated markers is updated by subsequent build", () => {
    const dir = makeTmpProject();

    // First build — no pre-existing docs
    const { code: code1 } = runCli(["build"], dir);
    expect(code1).toBe(0);

    const indexPath = path.join(dir, "logbook", "docs", "index.md");
    const after1 = fs.readFileSync(indexPath, "utf8");
    expect(after1).toContain("<!-- logbook:doc:index start v=1 -->");

    // Add a new event to change the data
    const eventsPath = path.join(dir, "logbook", "evidence", "events.jsonl");
    const newEvent = {
      id: "M01",
      type: "manual.milestone",
      ts: "2026-01-02T00:00:00.000Z",
      title: "New milestone",
      description: "Added after first build",
    };
    fs.appendFileSync(eventsPath, JSON.stringify(newEvent) + "\n", "utf8");

    // Second build — should update the generated content
    const { code: code2 } = runCli(["build"], dir);
    expect(code2).toBe(0);

    const after2 = fs.readFileSync(indexPath, "utf8");
    // Generated markers still present
    expect(after2).toContain("<!-- logbook:doc:index start v=1 -->");
    // New content is present inside the markers
    // (milestones section updated)
    expect(after2).toContain("New milestone");
  });

  it("user prose in timeline.md is preserved", () => {
    const dir = makeTmpProject();
    const timelinePath = path.join(dir, "logbook", "docs", "timeline.md");

    const userProse = "# My Custom Timeline Header\n\nUser notes about the timeline.\n\n";
    fs.writeFileSync(timelinePath, userProse, "utf8");

    const { code } = runCli(["build"], dir);
    expect(code).toBe(0);

    const after = fs.readFileSync(timelinePath, "utf8");
    expect(after.startsWith(userProse)).toBe(true);
    expect(after).toContain("<!-- logbook:doc:timeline start v=1 -->");
  });
});
