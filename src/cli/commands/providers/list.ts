/**
 * logbook providers list — List configured LLM providers.
 *
 * Reads .logbook/providers.json; returns default config if missing.
 * Output:
 *  --json  → JSON { default_provider, providers, by_task, by_phase }
 *  default → human-readable table
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import type { ProvidersConfig } from "../../../types/providers.js";

/** Safe default config when providers.json is absent. */
const DEFAULT_PROVIDERS_CONFIG: ProvidersConfig = {
  default_provider: "anthropic-claude-sdk",
  providers: {
    "anthropic-claude-sdk": {
      kind: "anthropic",
      model: "claude-sonnet-4-5",
      api_key_env: "ANTHROPIC_API_KEY",
    },
  },
  by_task: {},
  by_phase: {},
};

function loadConfig(providersPath: string): ProvidersConfig {
  if (!fs.existsSync(providersPath)) return DEFAULT_PROVIDERS_CONFIG;
  try {
    const raw = fs.readFileSync(providersPath, "utf-8");
    return JSON.parse(raw) as ProvidersConfig;
  } catch {
    return DEFAULT_PROVIDERS_CONFIG;
  }
}

function renderTable(cfg: ProvidersConfig): string {
  const lines: string[] = [];
  lines.push(`default_provider: ${cfg.default_provider}`);
  lines.push("");
  lines.push("providers:");
  for (const [alias, entry] of Object.entries(cfg.providers)) {
    lines.push(`  ${alias}: ${entry.kind}/${entry.model}`);
  }
  lines.push("");
  lines.push("by_task:");
  const taskEntries = Object.entries(cfg.by_task);
  if (taskEntries.length === 0) {
    lines.push("  (none)");
  } else {
    for (const [task, provider] of taskEntries) {
      lines.push(`  ${task}: ${provider}`);
    }
  }
  lines.push("");
  lines.push("by_phase:");
  const phaseEntries = Object.entries(cfg.by_phase);
  if (phaseEntries.length === 0) {
    lines.push("  (none)");
  } else {
    for (const [phase, provider] of phaseEntries) {
      lines.push(`  ${phase}: ${provider}`);
    }
  }
  return lines.join("\n");
}

export default defineCommand({
  meta: {
    name: "list",
    description: "List configured LLM providers",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    let root: string;
    try {
      root = resolveProjectRoot();
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    const paths = makePaths(root);
    const cfg = loadConfig(paths.providersPath);

    if (args["json"]) {
      process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
    } else {
      process.stdout.write(renderTable(cfg) + "\n");
    }

    process.exit(0);
  },
});
