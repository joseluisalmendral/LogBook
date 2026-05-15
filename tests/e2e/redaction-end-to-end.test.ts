/**
 * Test 4 — Redaction E2E
 *
 * Feeds all 4 hook payload fixtures through `logbook ingest claude` and
 * verifies that secrets are redacted and benign values pass through intact.
 * Also verifies events.jsonl ends with "\n" (atomic append contract).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { describe, test, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");
const FIXTURES = path.join(ROOT, "tests/fixtures/claude-hook-payloads");

function pipeToIngest(
  fixtureName: string,
  cwd: string,
  sessionId: string,
): { code: number } {
  const input = fs.readFileSync(path.join(FIXTURES, fixtureName), "utf8");
  const result = spawnSync(
    "node",
    [CLI, "ingest", "claude", "--session-id", sessionId],
    {
      cwd,
      input,
      encoding: "utf8",
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
      timeout: 10_000,
    },
  );
  return { code: result.status ?? 1 };
}

function readEventsJsonl(cwd: string): unknown[] {
  const p = path.join(cwd, "logbook", "evidence", "events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe("Test 4 — Redaction E2E", () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      execFileSync("pnpm", ["build"], { stdio: "inherit", cwd: ROOT });
    }

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-redact-e2e-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    const init = spawnSync("node", [CLI, "init", "--preset", "minimal", "--yes"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
    });
    if ((init.status ?? 1) !== 0) {
      throw new Error(`init failed: ${init.stderr}`);
    }

    // Feed all 4 fixtures
    const fixtures = [
      { file: "user-message.json",           session: "e2e-sess-user" },
      { file: "tool-use.json",               session: "e2e-sess-tool" },
      { file: "tool-result-with-secrets.json", session: "e2e-sess-secrets" },
      { file: "benign-uuid-and-sha.json",    session: "e2e-sess-benign" },
    ];
    for (const { file, session } of fixtures) {
      const r = pipeToIngest(file, tmp, session);
      if (r.code !== 0) throw new Error(`ingest failed for ${file}`);
    }
  });

  test("events.jsonl ends with \\n (atomic append contract)", () => {
    const eventsPath = path.join(tmp, "logbook", "evidence", "events.jsonl");
    expect(fs.existsSync(eventsPath)).toBe(true);
    const raw = fs.readFileSync(eventsPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  test("secrets fixture: redacted=true", () => {
    const events = readEventsJsonl(tmp);
    const ev = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "e2e-sess-secrets",
    ) as Record<string, unknown> | undefined;
    expect(ev).toBeDefined();
    expect(ev?.["redacted"]).toBe(true);
  });

  test("secrets fixture: AWS access key is redacted", () => {
    const events = readEventsJsonl(tmp);
    const ev = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "e2e-sess-secrets",
    ) as Record<string, unknown> | undefined;
    const line = JSON.stringify(ev);
    expect(line).toContain("[REDACTED:aws-access-key-id]");
    expect(line).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("secrets fixture: GitHub PAT is redacted", () => {
    const events = readEventsJsonl(tmp);
    const ev = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "e2e-sess-secrets",
    ) as Record<string, unknown> | undefined;
    const line = JSON.stringify(ev);
    expect(line).toContain("[REDACTED:github-pat-classic]");
    expect(line).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
  });

  test("secrets fixture: 38-char hex blob is redacted as high-entropy", () => {
    const events = readEventsJsonl(tmp);
    const ev = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "e2e-sess-secrets",
    ) as Record<string, unknown> | undefined;
    const line = JSON.stringify(ev);
    // The 38-char hex blob is not a known hash length → high-entropy redaction
    expect(line).toContain("[REDACTED:high-entropy]");
    expect(line).not.toContain("c3f8e2a190b457d6f123e789abc456def01234");
  });

  test("benign fixture: redacted=false", () => {
    const events = readEventsJsonl(tmp);
    const ev = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "e2e-sess-benign",
    ) as Record<string, unknown> | undefined;
    expect(ev).toBeDefined();
    expect(ev?.["redacted"]).toBe(false);
  });

  test("benign fixture: UUID passes through unredacted", () => {
    const events = readEventsJsonl(tmp);
    const ev = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "e2e-sess-benign",
    ) as Record<string, unknown> | undefined;
    const line = JSON.stringify(ev);
    expect(line).toContain("123e4567-e89b-12d3-a456-426614174000");
  });

  test("benign fixture: SHA-256 of 'hello' passes through unredacted (hash-shape filter)", () => {
    const events = readEventsJsonl(tmp);
    const ev = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "e2e-sess-benign",
    ) as Record<string, unknown> | undefined;
    const line = JSON.stringify(ev);
    // S2.D5: hash-shape filter — sha256 is now NOT redacted
    expect(line).toContain("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  test("benign fixture: filename 'src/foo.ts' passes through unredacted", () => {
    const events = readEventsJsonl(tmp);
    const ev = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "e2e-sess-benign",
    ) as Record<string, unknown> | undefined;
    const line = JSON.stringify(ev);
    expect(line).toContain("src/foo.ts");
  });
});
