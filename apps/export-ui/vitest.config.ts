import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The smoke tests touch the filesystem (apps/export-ui/dist/index.html)
    // and shell out to `pnpm build`. A node environment is enough.
    testTimeout: 120_000,
    // Run tests serially — the build test owns the dist/ directory and
    // would race with anything else that reads it.
    fileParallelism: false,
  },
});
