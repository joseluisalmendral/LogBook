/**
 * logbook providers set <target> <provider> [--model <m>]
 *
 * Sets a provider mapping for a task or phase.
 *
 * target format:
 *   task:<name>   → updates by_task[<name>] = <provider>
 *   phase:<name>  → updates by_phase[<name>] = <provider>
 *
 * If --model is supplied, also updates providers[<provider>].model.
 *
 * If <provider> alias does not exist in the providers map, a placeholder
 * entry is auto-created (kind "anthropic", api_key_env "ANTHROPIC_API_KEY").
 * This avoids blocking the user — they can fill in the details later.
 *
 * Output: JSON { key, provider, model? }
 *
 * Design: atomic write (tmpfile+rename); 2-space JSON indent; consistent with
 * iter1+iter2 file IO conventions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import { backupOnce } from "../../../core/backup.js";
import type { ProvidersConfig, ProviderEntry } from "../../../types/providers.js";

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
  if (!fs.existsSync(providersPath)) return structuredClone(DEFAULT_PROVIDERS_CONFIG);
  try {
    const raw = fs.readFileSync(providersPath, "utf-8");
    return JSON.parse(raw) as ProvidersConfig;
  } catch {
    return structuredClone(DEFAULT_PROVIDERS_CONFIG);
  }
}

function saveConfig(providersPath: string, cfg: ProvidersConfig): void {
  const dir = path.dirname(providersPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${providersPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, providersPath);
}

export default defineCommand({
  meta: {
    name: "set",
    description: "Set provider mapping for a task or phase",
  },
  args: {
    target: {
      type: "positional",
      required: true,
      description: "task:<name> or phase:<name>",
    },
    provider: {
      type: "positional",
      required: true,
      description: "Provider alias (must exist or will be auto-created)",
    },
    model: {
      type: "string",
      required: false,
      description: "Override model (writes to provider entry)",
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

    const targetArg = args["target"] as string;
    const providerAlias = args["provider"] as string;
    const modelOverride = args["model"] as string | undefined;

    // Parse target: must start with "task:" or "phase:"
    let mapKey: "by_task" | "by_phase";
    let name: string;

    if (targetArg.startsWith("task:")) {
      mapKey = "by_task";
      name = targetArg.slice("task:".length);
    } else if (targetArg.startsWith("phase:")) {
      mapKey = "by_phase";
      name = targetArg.slice("phase:".length);
    } else {
      process.stderr.write(
        `error: invalid target "${targetArg}" — expected "task:<name>" or "phase:<name>"\n`,
      );
      process.exit(1);
    }

    if (!name || !name.trim()) {
      process.stderr.write(
        `error: target name cannot be empty — got "${targetArg}"\n`,
      );
      process.exit(1);
    }

    const paths = makePaths(root);

    // Backup providers.json before any mutation (idempotent; sentinel if file absent).
    backupOnce(paths.providersPath, {
      backupsDir: paths.backupsDir,
      projectRoot: root,
      now: () => new Date().toISOString(),
    });

    const cfg = loadConfig(paths.providersPath);

    // If provider alias doesn't exist, auto-create a placeholder
    if (!(providerAlias in cfg.providers)) {
      const placeholder: ProviderEntry = {
        kind: "anthropic",
        model: modelOverride ?? "claude-sonnet-4-5",
        api_key_env: "ANTHROPIC_API_KEY",
      };
      cfg.providers[providerAlias] = placeholder;
    }

    // Update the routing map
    cfg[mapKey][name] = providerAlias;

    // If --model is set, update the provider entry's model
    if (modelOverride !== undefined && modelOverride !== "") {
      const entry = cfg.providers[providerAlias];
      if (entry !== undefined) {
        entry.model = modelOverride;
      }
    }

    saveConfig(paths.providersPath, cfg);

    const result: Record<string, unknown> = {
      key: targetArg,
      provider: providerAlias,
    };
    if (modelOverride !== undefined && modelOverride !== "") {
      result["model"] = modelOverride;
    }

    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(0);
  },
});
