/**
 * Integration tests for `logbook ingest otel <file>`.
 *
 * Requires a built CLI at dist/cli/index.cjs.
 *
 * Note: fixture files are copied into the temp project directory before use,
 * because `logbook ingest otel` path-confines the input file to the project root.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");
const FIXTURES = path.join(ROOT, "tests/fixtures/otel");

function runIngestOtel(
  file: string,
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, "ingest", "otel", file], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      LOGBOOK_HOOK_PATH: HOOK_CJS,
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readEventsJsonl(cwd: string): Record<string, unknown>[] {
  const eventsPath = path.join(cwd, "logbook", "evidence", "events.jsonl");
  if (!fs.existsSync(eventsPath)) return [];
  return fs
    .readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("I-OTel — ingest otel file", () => {
  let tmp: string;
  let sampleChatFile: string;
  let multiSpanFile: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-iotel-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-otel-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    const initResult = spawnSync("node", [CLI, "init", "--preset", "minimal", "--yes"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
    });
    if ((initResult.status ?? 1) !== 0) {
      throw new Error(`init failed: ${initResult.stderr}`);
    }

    // Copy fixture files into the temp project so path-confine accepts them.
    sampleChatFile = path.join(tmp, "sample-chat-span.json");
    multiSpanFile = path.join(tmp, "multi-span.jsonl");
    fs.copyFileSync(path.join(FIXTURES, "sample-chat-span.json"), sampleChatFile);
    fs.copyFileSync(path.join(FIXTURES, "multi-span.jsonl"), multiSpanFile);
  });

  // -------------------------------------------------------------------------
  // Happy path: single-envelope JSON file
  // -------------------------------------------------------------------------

  it("exits 0 for sample-chat-span.json", () => {
    const result = runIngestOtel(sampleChatFile, tmp);
    expect(result.code).toBe(0);
  });

  it("outputs JSON with ingested count for sample-chat-span.json", () => {
    const result = runIngestOtel(sampleChatFile, tmp);
    const json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(typeof json["ingested"]).toBe("number");
    expect(json["ingested"]).toBeGreaterThanOrEqual(1);
  });

  it("events.jsonl has events with provider=anthropic after sample-chat-span.json", () => {
    // Run once more to ensure at least one event is present
    runIngestOtel(sampleChatFile, tmp);
    const events = readEventsJsonl(tmp);
    const otelEvent = events.find((e) => e["provider"] === "anthropic");
    expect(otelEvent).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Happy path: JSONL file (multiple envelopes)
  // -------------------------------------------------------------------------

  it("exits 0 for multi-span.jsonl", () => {
    const result = runIngestOtel(multiSpanFile, tmp);
    expect(result.code).toBe(0);
  });

  it("ingests 2 events from multi-span.jsonl", () => {
    // Count events before
    const before = readEventsJsonl(tmp).length;
    runIngestOtel(multiSpanFile, tmp);
    const after = readEventsJsonl(tmp).length;
    expect(after - before).toBe(2);
  });

  it("output JSON from multi-span.jsonl has ingested=2", () => {
    const result = runIngestOtel(multiSpanFile, tmp);
    const json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(json["ingested"]).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Malformed file → exit 0, ingested=0 (defensive, no crash)
  // -------------------------------------------------------------------------

  it("exits 0 for a malformed (non-JSON) file", () => {
    const malformedFile = path.join(tmp, "bad.json");
    fs.writeFileSync(malformedFile, "this is not json {{{{");
    const result = runIngestOtel(malformedFile, tmp);
    expect(result.code).toBe(0);
  });

  it("reports ingested=0 for a malformed file", () => {
    const malformedFile = path.join(tmp, "bad2.json");
    fs.writeFileSync(malformedFile, "not valid json at all");
    const result = runIngestOtel(malformedFile, tmp);
    const json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(json["ingested"]).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Path escape → exit 1
  // -------------------------------------------------------------------------

  it("exits 1 when file is outside the project root (path escape)", () => {
    // Pass an absolute path to a file outside the temp project root.
    // We use the CLI itself as a convenient file that exists outside tmp.
    const result = runIngestOtel(CLI, tmp);
    // Path outside project root must be rejected with exit code 1
    expect(result.code).toBe(1);
  });
});
