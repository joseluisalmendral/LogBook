/**
 * ArtifactInstaller<A> — the interface contract every concrete installer implements.
 *
 * Design (§5): one installer per artifact kind. The install-engine calls detect()
 * before writing anything, then install() / uninstall() / verify() per artifact.
 * All operations are async because most will do I/O.
 */

import type { Artifact } from "../../../types/artifact.js";
import type { ManifestArtifact, Manifest, BackupRef } from "../../../types/manifest.js";
import type { ProjectPaths } from "../../../core/paths.js";
import type { DryRunContext } from "../../../core/dryrun.js";
import type { ArtifactKindName } from "./kinds.js";

export interface InstallContext {
  projectRoot: string;             // absolute path; all writes confined within
  preset: Manifest["preset"];
  manifest: Manifest;              // in-memory; mutated via the install-engine
  backups: Map<string, BackupRef>; // already-taken backups in this run (keyed by abs path)
  dryRun: boolean;
  dryRunContext?: DryRunContext | undefined;   // present iff dryRun === true
  now: () => string;              // injectable clock — returns RFC3339 UTC string
  ulid: () => string;             // injectable for deterministic tests
  paths: ProjectPaths;
}

export type DetectionResult =
  | { status: "empty" }
  | { status: "occupied-by-logbook"; existing: ManifestArtifact }
  | { status: "occupied-by-other"; fingerprint: string };

export interface VerifyResult {
  ok: boolean;
  reason?: "anchor_missing" | "hash_mismatch" | "file_missing";
}

export interface ArtifactInstaller<A extends Artifact = Artifact> {
  /** Discriminator — must match the artifact's `kind` field. */
  readonly kind: ArtifactKindName;
  /**
   * Inspect the target file and classify the current state:
   * - "empty": target slot is available for install.
   * - "occupied-by-logbook": already installed by LogBook (can be skipped or updated).
   * - "occupied-by-other": slot is taken by another tool — log a warning but don't block.
   */
  detect(artifact: A, ctx: InstallContext): Promise<DetectionResult>;
  /**
   * Write the artifact to disk. Returns the ManifestArtifact that describes the
   * installed artifact (used by the engine to update the in-memory manifest).
   * Must NOT be called if detect() returned "occupied-by-logbook".
   */
  install(artifact: A, ctx: InstallContext): Promise<ManifestArtifact>;
  /**
   * Remove the artifact from disk. Called by the uninstall-engine in reverse order.
   * Must be idempotent: if the artifact is already gone, do not throw.
   */
  uninstall(entry: ManifestArtifact, ctx: InstallContext): Promise<void>;
  /**
   * Check that the installed artifact still matches the recorded content_hash.
   * Returns ok:false with a reason when the artifact has drifted.
   */
  verify(entry: ManifestArtifact, ctx: InstallContext): Promise<VerifyResult>;
}
