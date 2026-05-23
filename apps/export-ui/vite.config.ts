import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

// vite-plugin-singlefile MUST be last so it can inline all emitted JS/CSS into
// a single dist/index.html. cssCodeSplit: false + assetsInlineLimit: ∞ +
// inlineDynamicImports defeat code-splitting at every layer (design §6.1).
export default defineConfig({
  base: "",
  plugins: [svelte(), viteSingleFile()],
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
