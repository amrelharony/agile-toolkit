import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest configuration for the Agile Toolkit.
 *
 * Uses jsdom so tests can touch browser-shaped globals (window, document)
 * even though we mostly test pure logic. The @/* alias mirrors the
 * tsconfig.json paths entry so test imports look like product imports.
 *
 * `esbuild.jsx: "automatic"` overrides the app's tsconfig `jsx: "preserve"`
 * (Next relies on its own bundler) so component-render tests (*.test.tsx,
 * e.g. test/canvas/object-renderer.test.tsx via @testing-library/react) get
 * their JSX transformed with the React 17+ automatic runtime — no explicit
 * `import React` needed. Pure-logic *.test.ts tests are unaffected.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./test/stubs/server-only.ts"),
    },
  },
});
