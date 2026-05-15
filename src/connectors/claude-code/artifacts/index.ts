/**
 * Bootstrap registration for all Claude Code artifact installers.
 *
 * Call bootstrapClaudeCodeInstallers() once before using the registry.
 * The function is idempotent — calling it multiple times is safe.
 *
 * Tests should call clearRegistry() in beforeEach, then bootstrapClaudeCodeInstallers().
 * Production code (CLI init) calls this once at startup.
 */

import { register, listRegistered } from "./registry.js";
import { HookInstaller } from "./hook.js";
import { GitignoreInstaller } from "./gitignore.js";

let bootstrapped = false;

/**
 * Register all iter1 installers into the global registry.
 * Idempotent: subsequent calls are no-ops.
 */
export function bootstrapClaudeCodeInstallers(): void {
  if (bootstrapped) return;
  register(new HookInstaller());
  register(new GitignoreInstaller());
  bootstrapped = true;
}

/**
 * Reset the bootstrap flag. FOR TESTS ONLY — allows clearRegistry() + re-bootstrap
 * between test cases without the "already registered" guard firing.
 *
 * Must be called AFTER clearRegistry() to stay consistent.
 */
export function _resetBootstrapFlag(): void {
  bootstrapped = false;
}
