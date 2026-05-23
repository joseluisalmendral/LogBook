import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// vite-plugin-singlefile MUST be last so it can inline all emitted JS/CSS into
// a single dist/index.html. cssCodeSplit: false + assetsInlineLimit: ∞ +
// inlineDynamicImports defeat code-splitting at every layer (design §6.1).

/**
 * Dev-only payload injection plugin.
 *
 * In dev mode, reads `src/dev-payload.json` and injects its content into the
 * empty <script id="lb-data" type="application/json"> placeholder. Production
 * builds never run this — the placeholder stays empty so the export pipeline
 * (P5) can write the real payload into the vendored bundle.
 *
 * This unblocks visual verification per `feedback_opus_for_visual_slices_logbook`:
 * the design must render with realistic data so the editorial palette + tile
 * grid + sort cycling can be inspected, not just smoke-tested.
 */
function devPayloadInjection(): Plugin {
  return {
    name: "lb-dev-payload-injection",
    apply: "serve", // dev-only
    transformIndexHtml(html: string): string {
      try {
        const payloadPath = resolve(__dirname, "src/dev-payload.json");
        const raw = readFileSync(payloadPath, "utf8");
        // Escape </script so the JSON can be safely embedded — matches the
        // R-43 contract that P5 will enforce in src/export/html.ts.
        const escaped = raw.replace(/<\/script>/gi, "<\\/script>");
        return html.replace(
          /<script id="lb-data" type="application\/json">\s*<\/script>/,
          `<script id="lb-data" type="application/json">${escaped}</script>`,
        );
      } catch {
        // Missing fixture is non-fatal — the UI gracefully degrades to
        // emptyPayload() via the data store.
        return html;
      }
    },
  };
}

export default defineConfig({
  base: "",
  plugins: [svelte(), devPayloadInjection(), viteSingleFile()],
  build: {
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});
