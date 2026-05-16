/**
 * Integration test: `logbook providers list` CLI command (T7).
 *
 * Tests:
 *  1. No providers.json → returns default config (empty maps, sensible default provider)
 *  2. providers.json present → returns configured content
 *  3. Table format (no --json) → stdout contains key labels
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
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`,
      );
    }
  }
}, 90_000);

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-providers-list-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
  return dir;
}

function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("cli-providers-list", () => {
  it("returns default config when providers.json is missing", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(["providers", "list", "--json"], dir);

    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["default_provider"]).toBe("string");
    expect(out["default_provider"]).not.toBe("");
    expect(typeof out["providers"]).toBe("object");
    expect(typeof out["by_task"]).toBe("object");
    expect(typeof out["by_phase"]).toBe("object");
  });

  it("returns configured content when providers.json exists", () => {
    const dir = makeTmpProject();
    const providersConfig = {
      default_provider: "my-anthropic",
      providers: {
        "my-anthropic": {
          kind: "anthropic",
          model: "claude-sonnet-4-5",
          api_key_env: "ANTHROPIC_API_KEY",
        },
        "my-openai": {
          kind: "openai",
          model: "gpt-4o",
          api_key_env: "OPENAI_API_KEY",
        },
      },
      by_task: { "summarize.milestone": "my-openai" },
      by_phase: { apply: "my-anthropic" },
    };
    fs.writeFileSync(
      path.join(dir, ".logbook", "providers.json"),
      JSON.stringify(providersConfig, null, 2),
    );

    const { code, stdout } = runCli(["providers", "list", "--json"], dir);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["default_provider"]).toBe("my-anthropic");
    expect((out["providers"] as Record<string, unknown>)["my-openai"]).toBeDefined();
    expect((out["by_task"] as Record<string, unknown>)["summarize.milestone"]).toBe("my-openai");
    expect((out["by_phase"] as Record<string, unknown>)["apply"]).toBe("my-anthropic");
  });

  it("table format output contains expected labels", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(["providers", "list"], dir);

    expect(code).toBe(0);
    // Table format should mention the default_provider label
    expect(stdout).toMatch(/default_provider|Default Provider|default/i);
  });
});
