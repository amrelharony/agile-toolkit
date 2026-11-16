// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * lib/notebook is read by the tool.sm_notebook agent actions inside the MCP
 * route handler, and by the notebook's AI task, whose fallback the server
 * runs too. There a "use client" module's exports are client references,
 * not functions, so nothing they import, however deep, may be one; nor
 * React DOM or the store. (The tool registry it links through, with its
 * icons, is read on the server elsewhere too.)
 */
const ROOT = process.cwd();
const ENTRIES = [
  "src/lib/notebook/model.ts",
  "src/lib/notebook/themes.ts",
  "src/lib/notebook/summary.ts",
  "src/lib/notebook/tools.ts",
  "src/lib/notebook/templates.ts",
  "src/lib/notebook/next-step.ts",
  "src/lib/ai/tasks/sm-notebook.ts",
].map((f) => path.join(ROOT, f));
const BANNED_PACKAGES = ["react-dom", "zustand"];

/** The specifiers a module imports values from (type-only imports are erased). */
function valueImports(src: string): string[] {
  const from = Array.from(
    src.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/gm)
  ).map((m) => m[1]);
  const bare = Array.from(src.matchAll(/^import\s+["']([^"']+)["']/gm)).map((m) => m[1]);
  return [...from, ...bare];
}

/** A source file for an "@/" or relative specifier, or null for a package. */
function resolve(spec: string, importer: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(importer), spec)
      : null;
  if (base === null) return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  throw new Error(`${importer} imports ${spec}, which doesn't resolve`);
}

describe("lib/notebook on the server", () => {
  it("imports no client module, React DOM or the store, directly or through another module", () => {
    const seen = new Set<string>();
    const packages = new Set<string>();
    const queue = [...ENTRIES];
    while (queue.length) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      const rel = path.relative(ROOT, file);
      expect(/^\s*["']use client["']/.test(src), `${rel} is a "use client" module`).toBe(false);
      for (const spec of valueImports(src)) {
        const next = resolve(spec, file);
        if (next) queue.push(next);
        else packages.add(spec);
        expect(spec, `${rel} imports the store`).not.toMatch(/stores\/workspace-store/);
      }
    }
    // It did walk the libraries (a broken walk would pass vacuously).
    expect(seen.size).toBeGreaterThan(8);
    for (const banned of BANNED_PACKAGES) expect(Array.from(packages)).not.toContain(banned);
  });
});
