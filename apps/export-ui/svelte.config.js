import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Svelte 5 — runes mode opt-in is per-file via $state/$derived; left default-undefined
    // so existing non-runes templates still compile when added later.
  },
};
