/**
 * Install engine — 13-step discovery + install algorithm (§6 of the design).
 *
 * Responsibilities:
 * 1. Resolve installers from registry for every artifact.
 * 2. Run detect() per artifact to build the DiscoveryReport.
 * 3. Scan for known plugin fingerprints in settings.local.json.
 * 4. Check disableAllHooks flag.
 * 5. Deliver the report via onReport().
 * 6. If dryRun → return immediately, no disk writes.
 * 7. Backup phase: backupOnce() for every file that will be written.
 * 8. Install in input order; on failure rollback in REVERSE order.
 * 9. Flush manifest atomically.
 *
 * The engine is intentionally decoupled from specific artifact kinds — it
 * operates through the ArtifactInstaller interface and the registry.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Artifact } from "../types/artifact.js";
import type { ManifestArtifact, Manifest, BackupRef } from "../types/manifest.js";
import type { ProjectPaths } from "./paths.js";
import { emptyManifest, readManifest, writeManifest, addArtifact, addBackup } from "./manifest.js";
import { backupOnce } from "./backup.js";
import { getInstaller } from "../connectors/claude-code/artifacts/registry.js";
import type { DetectionResult } from "../connectors/claude-code/artifacts/installer.js";
import { generateUlid } from "../util/ulid.js";
import { DryRunContext } from "./dryrun.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunInstallInput {
  paths: ProjectPaths;
  preset: Manifest["preset"];
  artifacts: Artifact[];
  dryRun: boolean;
  onReport?: (report: DiscoveryReport) => void;
  now?: () => string;
  ulid?: () => string;
}

export interface DiscoveryReportRow {
  kind: string;
  filePath: string;
  status: DetectionResult["status"];
  action: "will-install" | "skip-already-present" | "coexist-append" | "blocked";
  note?: string;
}

export interface DiscoveryReport {
  rows: DiscoveryReportRow[];
  plannedBackups: string[];
  warnings: string[];
}

export interface RunInstallResult {
  manifest: Manifest;
  installed: ManifestArtifact[];
  skipped: { artifact: Artifact; reason: string }[];
  report: DiscoveryReport;
}

// Known plugin fingerprints — field names in settings.local.json that belong
// to other tools. We flag them in the report but never block the install.
const KNOWN_FINGERPRINT_FIELDS = ["_gentleAiId", "_lbId", "_agentId"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read settings.local.json as raw text. Returns null if absent or unreadable. */
function readSettingsRaw(paths: ProjectPaths): string | null {
  const settingsPath = path.join(paths.root, ".claude", "settings.local.json");
  try {
    if (!fs.existsSync(settingsPath)) return null;
    return fs.readFileSync(settingsPath, "utf8");
  } catch {
    return null;
  }
}

/** Parse settings.local.json read-only. Returns null if absent or malformed. */
function readSettingsParsed(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runInstall(input: RunInstallInput): Promise<RunInstallResult> {
  const { paths, preset, artifacts, dryRun } = input;
  const now = input.now ?? (() => new Date().toISOString());
  const ulid = input.ulid ?? generateUlid;

  // step 1: Resolve installers from registry for each artifact.
  // Throw early if any kind has no registered installer.
  const installerMap = new Map<string, ReturnType<typeof getInstaller>>();
  for (const artifact of artifacts) {
    if (!installerMap.has(artifact.kind)) {
      // getInstaller throws if not registered
      installerMap.set(artifact.kind, getInstaller(artifact.kind));
    }
  }

  // Build the initial in-memory manifest (read existing if present, else create fresh).
  let manifest: Manifest = readManifest(paths.manifestPath) ?? emptyManifest(preset);
  // Override preset in case manifest already exists with different preset.
  // The engine always uses the caller-supplied preset.
  manifest = { ...manifest, preset };

  // step 2: Run detect() per artifact and build the DiscoveryReport.
  const detections = new Map<Artifact, DetectionResult>();
  const backupCtx = {
    backupsDir: paths.backupsDir,
    projectRoot: paths.root,
    now,
  };
  const dryRunCtx = dryRun ? new DryRunContext() : undefined;

  const installCtx = {
    projectRoot: paths.root,
    preset,
    manifest,
    backups: new Map<string, BackupRef>(),
    dryRun,
    dryRunContext: dryRunCtx,
    now,
    ulid,
    paths,
  };

  const reportRows: DiscoveryReportRow[] = [];
  for (const artifact of artifacts) {
    const installer = installerMap.get(artifact.kind)!;
    const detection = await installer.detect(artifact, installCtx);
    detections.set(artifact, detection);

    let action: DiscoveryReportRow["action"];
    switch (detection.status) {
      case "empty":
        action = "will-install";
        break;
      case "occupied-by-logbook":
        action = "skip-already-present";
        break;
      case "occupied-by-other":
        action = "coexist-append";
        break;
    }

    // Resolve file_path from detection context — use a type-safe approach:
    // We cannot read file_path from Artifact directly (not all kinds have it);
    // use the ManifestArtifact.file_path from occupied-by-logbook if available.
    const filePath =
      detection.status === "occupied-by-logbook"
        ? detection.existing.file_path
        : getArtifactFilePath(artifact);

    reportRows.push({
      kind: artifact.kind,
      filePath,
      status: detection.status,
      action,
    });
  }

  // step 3: Scan for plugin fingerprints in settings.local.json.
  const warnings: string[] = [];
  const rawSettings = readSettingsRaw(paths);
  if (rawSettings) {
    for (const field of KNOWN_FINGERPRINT_FIELDS) {
      if (rawSettings.includes(`"${field}"`)) {
        warnings.push(`Plugin fingerprint detected in settings.local.json: "${field}"`);
      }
    }
  }

  // step 4: Check disableAllHooks flag.
  const parsedSettings = readSettingsParsed(rawSettings);
  if (parsedSettings && parsedSettings["disableAllHooks"] === true) {
    warnings.push(
      "settings.local.json has disableAllHooks:true — LogBook hooks will be installed but will not fire until this flag is removed."
    );
  }

  // Compute planned backups for the report: only for artifacts that will be written.
  const plannedBackups: string[] = [];
  for (const artifact of artifacts) {
    const detection = detections.get(artifact)!;
    if (detection.status !== "occupied-by-logbook") {
      const filePath = getArtifactFilePath(artifact);
      if (filePath && !plannedBackups.includes(filePath)) {
        plannedBackups.push(filePath);
      }
    }
  }

  const report: DiscoveryReport = { rows: reportRows, plannedBackups, warnings };

  // step 5: Deliver the report via onReport().
  input.onReport?.(report);

  // step 6: If dryRun → return immediately with empty installed[].
  if (dryRun) {
    return {
      manifest,
      installed: [],
      skipped: [],
      report,
    };
  }

  // step 7: Backup snapshot phase.
  // For each artifact whose detection.status !== "occupied-by-logbook",
  // call backupOnce for its target file.
  const backupsMap = new Map<string, BackupRef>();
  for (const artifact of artifacts) {
    const detection = detections.get(artifact)!;
    if (detection.status === "occupied-by-logbook") continue;

    const filePath = getArtifactFilePath(artifact);
    if (!filePath || backupsMap.has(filePath)) continue;

    const absPath = path.join(paths.root, filePath);
    const backupRef = backupOnce(absPath, backupCtx);
    backupsMap.set(filePath, backupRef);
  }

  // Persist backup refs into the manifest so the CLI can use them for cleanup on uninstall.
  for (const backupRef of backupsMap.values()) {
    manifest = addBackup(manifest, backupRef);
  }

  // Rebuild installCtx with the actual backups map.
  const installCtxWithBackups = { ...installCtx, backups: backupsMap };

  // step 8: Install in input order.
  const installed: ManifestArtifact[] = [];
  const skipped: { artifact: Artifact; reason: string }[] = [];

  for (const artifact of artifacts) {
    const detection = detections.get(artifact)!;
    const installer = installerMap.get(artifact.kind)!;

    if (detection.status === "occupied-by-logbook") {
      skipped.push({ artifact, reason: "already-present" });
      continue;
    }

    try {
      const manifestArtifact = await installer.install(artifact, installCtxWithBackups);
      installed.push(manifestArtifact);
      // Update in-memory manifest so subsequent installers can see prior entries.
      manifest = addArtifact(manifest, manifestArtifact);
      installCtxWithBackups.manifest = manifest;
    } catch (installError) {
      // On any installer throw: rollback in REVERSE order.
      const rollbackErrors: Error[] = [];
      for (let i = installed.length - 1; i >= 0; i--) {
        const entry = installed[i];
        if (!entry) continue;
        const rollbackInstaller = installerMap.get(entry.kind);
        if (!rollbackInstaller) continue;
        try {
          await rollbackInstaller.uninstall(entry, installCtxWithBackups);
        } catch (rollbackErr) {
          rollbackErrors.push(rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr)));
        }
      }

      // Manifest is NOT written on failure.
      // Bubble original error, attaching rollback errors as cause if any.
      if (rollbackErrors.length > 0 && installError instanceof Error) {
        const aggregate = new AggregateError(
          rollbackErrors,
          `Rollback encountered ${rollbackErrors.length} error(s) after install failure`
        );
        // Attach original error as cause.
        const wrapped = Object.assign(new Error(installError.message), {
          cause: aggregate,
          originalError: installError,
        });
        throw wrapped;
      }

      throw installError;
    }
  }

  // step 9: Flush manifest atomically only if anything was installed.
  // We always write the manifest if at least one artifact was installed (or if
  // the manifest didn't exist before). If everything was skipped and no new
  // artifacts were added, we still write to record the preset and installed_at.
  if (installed.length > 0) {
    writeManifest(paths.manifestPath, manifest);
  }

  return { manifest, installed, skipped, report };
}

// ---------------------------------------------------------------------------
// Utility: extract a best-effort file_path from an Artifact.
// Used for building the discovery report and planning backups.
// Not all artifact kinds have a file_path field — for those without one,
// returns an empty string (they manage their own target file).
// ---------------------------------------------------------------------------

function getArtifactFilePath(artifact: Artifact): string {
  switch (artifact.kind) {
    case "hook":
      return ".claude/settings.local.json";
    case "mcp_server":
      return ".claude/mcp.json";
    case "slash_command":
    case "skill":
    case "subagent":
    case "augment_claudemd":
    case "gitignore_entry":
      return artifact.file_path;
    case "statusline":
      return ".claude/settings.local.json";
  }
}
