/**
 * Integration test: `logbook providers set` CLI command (T7).
 *
 * Tests:
 *  1. set task:<name> <provider> → providers.json updated with by_task entry
 *  2. set phase:<name> <provider> --model <m> → by_phase updated + model on provider entry
 *  3. Invalid target (no task:/phase: prefix) → exit 1 with stderr
 *  4. Provider alias doesn't exist → auto-created as placeholder
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
    `lb-providers-set-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
  return dir;
}

function makeTmpProjectWithProviders(
  config: Record<string, unknown>,
): string {
  const dir = makeTmpProject();
  fs.writeFileSync(
    path.join(dir, ".logbook", "providers.json"),
    JSON.stringify(config, null, 2),
  );
  return dir;
}

function runCli(
  args: string[],
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readProviders(dir: string): Record<string, unknown> {
  const p = path.join(dir, ".logbook", "providers.json");
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
}

describe("cli-providers-set", () => {
  it("sets by_task entry when target is task:<name>", () => {
    const baseConfig = {
      default_provider: "anthropic-default",
      providers: {
        "anthropic-default": {
          kind: "anthropic",
          model: "claude-sonnet-4-5",
          api_key_env: "ANTHROPIC_API_KEY",
        },
      },
      by_task: {},
      by_phase: {},
    };
    const dir = makeTmpProjectWithProviders(baseConfig);

    const { code, stdout } = runCli(
      ["providers", "set", "task:summarize.milestone", "anthropic-default"],
      dir,
    );

    expect(code).toBe(0);
    const providers = readProviders(dir);
    expect((providers["by_task"] as Record<string, string>)["summarize.milestone"]).toBe(
      "anthropic-default",
    );

    // Should also print confirmation as JSON
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["key"]).toBe("task:summarize.milestone");
    expect(out["provider"]).toBe("anthropic-default");
  });

  it("sets by_phase entry when target is phase:<name> and updates model when --model is given", () => {
    const baseConfig = {
      default_provider: "anthropic-default",
      providers: {
        "anthropic-default": {
          kind: "anthropic",
          model: "claude-sonnet-4-5",
          api_key_env: "ANTHROPIC_API_KEY",
        },
        "openai-default": {
          kind: "openai",
          model: "gpt-4o-mini",
          api_key_env: "OPENAI_API_KEY",
        },
      },
      by_task: {},
      by_phase: {},
    };
    const dir = makeTmpProjectWithProviders(baseConfig);

    const { code, stdout } = runCli(
      ["providers", "set", "phase:apply", "openai-default", "--model", "gpt-4o"],
      dir,
    );

    expect(code).toBe(0);
    const providers = readProviders(dir);
    expect((providers["by_phase"] as Record<string, string>)["apply"]).toBe("openai-default");
    // model should be updated on the provider entry
    const providerEntry = (providers["providers"] as Record<string, Record<string, string>>)["openai-default"];
    expect(providerEntry?.["model"]).toBe("gpt-4o");

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["key"]).toBe("phase:apply");
    expect(out["provider"]).toBe("openai-default");
    expect(out["model"]).toBe("gpt-4o");
  });

  it("exits 1 with stderr when target has no task:/phase: prefix", () => {
    const dir = makeTmpProject();

    const { code, stderr } = runCli(
      ["providers", "set", "invalid-target", "anthropic-default"],
      dir,
    );

    expect(code).toBe(1);
    expect(stderr).toMatch(/task:|phase:|invalid|prefix|expected/i);
  });

  it("auto-creates provider placeholder when alias does not exist in providers map", () => {
    const baseConfig = {
      default_provider: "anthropic-default",
      providers: {
        "anthropic-default": {
          kind: "anthropic",
          model: "claude-sonnet-4-5",
          api_key_env: "ANTHROPIC_API_KEY",
        },
      },
      by_task: {},
      by_phase: {},
    };
    const dir = makeTmpProjectWithProviders(baseConfig);

    const { code } = runCli(
      ["providers", "set", "task:summarize.project", "new-provider"],
      dir,
    );

    // Auto-create: exits 0, new-provider placeholder exists in providers map
    expect(code).toBe(0);
    const providers = readProviders(dir);
    expect((providers["providers"] as Record<string, unknown>)["new-provider"]).toBeDefined();
    expect((providers["by_task"] as Record<string, string>)["summarize.project"]).toBe("new-provider");
  });
});
