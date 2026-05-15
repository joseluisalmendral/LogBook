/**
 * Artifact installer registry — singleton Map keyed by ArtifactKindName.
 *
 * Rules:
 * - register() throws if the same kind is registered twice (prevents silent overwrites).
 * - getInstaller() throws if no installer is registered for the requested kind.
 * - clearRegistry() is exported FOR TESTS ONLY. Production code must never call it.
 *
 * S7 will call register() at module load time for "hook" and "gitignore_entry".
 */

import type { ArtifactKindName } from "./kinds.js";
import type { ArtifactInstaller } from "./installer.js";

const REGISTRY = new Map<ArtifactKindName, ArtifactInstaller>();

/**
 * Register an installer for a kind. Throws if that kind is already registered.
 */
export function register(installer: ArtifactInstaller): void {
  if (REGISTRY.has(installer.kind)) {
    throw new Error(`Installer for kind '${installer.kind}' already registered`);
  }
  REGISTRY.set(installer.kind, installer);
}

/**
 * Look up the installer for a kind. Throws if none registered.
 */
export function getInstaller(kind: ArtifactKindName): ArtifactInstaller {
  const installer = REGISTRY.get(kind);
  if (!installer) {
    throw new Error(`No installer registered for kind '${kind}'`);
  }
  return installer;
}

/**
 * Returns a snapshot of all registered kind names (insertion order).
 */
export function listRegistered(): ArtifactKindName[] {
  return [...REGISTRY.keys()];
}

/**
 * Clear all registered installers.
 * EXPORTED FOR TESTS ONLY — never call from production code.
 */
export function clearRegistry(): void {
  REGISTRY.clear();
}
