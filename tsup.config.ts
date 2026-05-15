import { defineConfig } from "tsup";

export default defineConfig([
  {
    // CLI entry — the `logbook` binary
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["cjs"],
    target: "node22",
    outDir: "dist",
    bundle: true,
    clean: true,
    dts: false,
    sourcemap: false,
    minify: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
    noExternal: [/.*/],
  },
  {
    // Hook connector — small CJS bundle invoked by Claude Code's hook bus.
    // Keep imports MINIMAL: externalize heavy/native deps so the bundle stays
    // small and cold-start stays fast. splitting=false avoids chunk overhead.
    entry: { "connectors/claude-code/hook": "src/connectors/claude-code/hook.ts" },
    format: ["cjs"],
    target: "node22",
    outDir: "dist",
    bundle: true,
    clean: false,
    dts: false,
    sourcemap: false,
    minify: false,
    treeshake: true,
    splitting: false,
    // Externalize native/heavy deps even though the S4 hook does not import them.
    // Defensive: prevents accidental bundling if a future import slips in before S9.
    external: ["better-sqlite3", "proper-lockfile"],
  },
]);
