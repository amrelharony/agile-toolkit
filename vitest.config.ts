import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest configuration for the Agile Toolkit.
 *
 * Uses jsdom so tests can touch browser-shaped globals (window, document)
 * even though we mostly test pure logic. The @/* alias mirrors the
 * tsconfig.json paths entry so test imports look like product imports.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
