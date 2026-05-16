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
    // Externalize heavy/native deps. The CLI still bundles small JS deps
    // (citty, valibot, pathe, defu, consola, proper-lockfile) for portability,
    // but the AI SDKs are kept out of the cold-start hot path — they only get
    // resolved from node_modules when `logbook summarize` / `providers test`
    // are invoked.
    external: [
      "better-sqlite3",
      "ai",
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@anthropic-ai/claude-agent-sdk",
    ],
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
    // Externalize native/heavy deps even though the hook does not import them.
    // Defensive: prevents accidental bundling if a future import slips in.
    external: ["better-sqlite3", "proper-lockfile"],
  },
  {
    // MCP server — standalone CJS bundle spawned by Claude Code per session.
    //
    // IMPORTANT: @modelcontextprotocol/sdk is BUNDLED (not externalized).
    // Claude Code spawns the server with cwd = user project, so node_modules
    // resolution at runtime is NOT guaranteed. The SDK must be self-contained
    // in the bundle to avoid "Cannot find module" at startup.
    //
    // better-sqlite3 is externalized (native .node binding — cannot bundle).
    // It is always available in node_modules because it ships with LogBook.
    //
    // clean: false — preserves the cli/ and connectors/ outputs from prior
    // build steps. Each tsup config object runs sequentially in the array;
    // the first entry already set clean:true for the initial dist/ wipe.
    //
    // splitting: false — no chunk files; single self-contained .cjs.
    // sourcemap: false — production bundle; no source maps needed.
    entry: { "mcp/server": "src/mcp/server.ts" },
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
    // Only externalize the native module that CANNOT be bundled.
    // @modelcontextprotocol/sdk must be bundled for runtime portability.
    external: ["better-sqlite3"],
  },
  {
    // Export bundle — heavy unified/remark/rehype chain isolated here.
    //
    // CLI commands that need HTML export use a dynamic import() to lazy-load
    // this bundle only when `logbook export html` is actually invoked. This
    // keeps the CLI cold-start path (dist/cli/index.cjs) free from the
    // ~400 KB unified/remark/rehype weight.
    //
    // Entry: src/export/index.ts → dist/export/html.cjs
    // clean: false — preserves the cli/, connectors/, and mcp/ outputs built above.
    entry: { "export/html": "src/export/index.ts" },
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
    // Bundle everything including ESM-only unified/remark/rehype deps.
    // noExternal: [/.*/] overrides per-package externalization so that the
    // entire chain (unified, remark-parse, remark-rehype, rehype-stringify,
    // vfile, mdast, hast, etc.) is inlined into this self-contained CJS file.
    noExternal: [/.*/],
    // Re-add native module exclusion on top of noExternal (external wins).
    external: ["better-sqlite3"],
  },
]);
