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
    //
    // ink + react: kept out of the CJS CLI bundle because Ink 5.x is ESM with
    // top-level await. require()-ing an ESM-with-TLA graph fails on Node 22.
    // The TUI shell lives in its own ESM bundle (dist/tui/shell.mjs) and is
    // loaded at runtime via a Function() wrapper that defeats esbuild static
    // analysis (see maybeShell() in src/cli/index.ts).
    external: [
      "better-sqlite3",
      "ai",
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@ai-sdk/google",
      "@anthropic-ai/claude-agent-sdk",
      "ink",
      "react",
      "react-dom",
      "ink-testing-library",
    ],
  },
  {
    // TUI shell — ESM bundle, loaded at runtime from CLI via dynamic import.
    //
    // SEPARATE FROM CLI because Ink 5.x is ESM with top-level await. Node 22
    // rejects `require()` on ESM-with-TLA graphs, so the shell cannot ride
    // inside the CJS CLI bundle.
    //
    // CLI does: await (Function('p','return import(p)')(absoluteShellPath))
    // The Function() wrapper defeats esbuild's static analysis so Ink does
    // not get inlined into the CLI bundle.
    //
    // Entry: src/tui/shell.ts → dist/tui/shell.mjs
    // clean: false — preserves the cli/index.cjs built above.
    entry: { "tui/shell": "src/tui/shell.ts" },
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    bundle: true,
    clean: false,
    dts: false,
    sourcemap: false,
    minify: false,
    treeshake: true,
    splitting: false,
    // Force .mjs extension so Node treats this as ESM regardless of the
    // package.json `type` field (which is "commonjs" — the default).
    // Without this override, tsup would emit `.js` and Node would try to
    // parse it as CJS, breaking the dynamic import from CLI.
    outExtension: () => ({ js: ".mjs" }),
    // ESM shim for __dirname / __filename. The CJS-only globals are undefined
    // in ESM context; without this shim, calling buildArtifactsForPreset()
    // from the shell crashes with "__dirname is not defined" (real bug seen
    // in production on 2026-05-18).
    //
    // Strategy:
    //   `define` replaces every `__dirname` / `__filename` token in source
    //   with a globalThis access. `banner` sets those globals once at module
    //   load by computing them from `import.meta.url`. Using globalThis
    //   avoids esbuild's name-collision auto-rename (which silently broke a
    //   plain `const __dirname = ...` banner because some bundled deps also
    //   declared __dirname → esbuild alpha-renamed ours to $1).
    //
    // Geometry note: dist/tui/shell.mjs is a sibling of dist/cli/, dist/mcp/,
    // dist/connectors/, dist/export/ under dist/. So path.resolve(__dirname,
    // "..", ...) from this bundle yields the same paths as from dist/cli/.
    // The single exception (path.resolve(__dirname, "index.cjs") in
    // presets.ts) was refactored to use a distRoot-anchored path so it
    // works from any sibling bundle.
    define: {
      __dirname: "globalThis.__LB_ESM_DIRNAME",
      __filename: "globalThis.__LB_ESM_FILENAME",
    },
    banner: {
      js: `import { fileURLToPath as __lbFileURLToPath } from 'node:url';
import { dirname as __lbDirname } from 'node:path';
globalThis.__LB_ESM_FILENAME = __lbFileURLToPath(import.meta.url);
globalThis.__LB_ESM_DIRNAME = __lbDirname(globalThis.__LB_ESM_FILENAME);`,
    },
    // Bundle Ink + React + dependencies into the shell bundle. They are
    // ESM-native and bundle cleanly when the output is ESM.
    external: [
      "better-sqlite3",
      "ai",
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@ai-sdk/google",
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
  {
    // PDF export bundle (S5.1) — thin orchestrator around puppeteer-core.
    //
    // pdf.ts does NOT statically import instructor-pack.ts.
    // The instructor-pack pipeline (unified/remark/rehype) is loaded lazily at
    // runtime from dist/export/html.cjs via a non-literal require().
    // As a result, this bundle only contains the thin orchestration logic
    // and the STUB_PDF constant — expected size ≤80 KB.
    //
    // puppeteer-core is externalized (optionalDependency, not bundled).
    // pathe is the only small runtime dep — bundled via noExternal fallback.
    //
    // CLI lazy-loads this via: require(join(__dirname, "../../export/pdf.cjs"))
    // Entry: src/export/pdf.ts → dist/export/pdf.cjs
    // clean: false — preserves all prior build outputs.
    entry: { "export/pdf": "src/export/pdf.ts" },
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
    // Do NOT use noExternal: [/.*/] here — it would override the external list
    // and inline puppeteer-core (4 MB) into the bundle.
    //
    // Instead, explicitly externalize the heavy/optional/native deps.
    // pathe is the only runtime dep used directly in pdf.ts — tsup CJS
    // handles ESM interop for it automatically via the bundle transform.
    external: [
      "better-sqlite3",
      "puppeteer-core",
      // Externalize all unified/remark/rehype chain (loaded lazily via html.cjs)
      "unified",
      "remark-parse",
      "remark-rehype",
      "rehype-slug",
      "rehype-stringify",
      // AI SDKs (not used in pdf.ts, but defensive)
      "ai",
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@ai-sdk/google",
      "@anthropic-ai/claude-agent-sdk",
    ],
  },
]);
