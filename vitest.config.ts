import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    testTimeout: 30_000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    setupFiles: ["./tests/setup.ts"],
  },
});
