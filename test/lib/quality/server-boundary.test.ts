// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The quality libraries are read by the four tools' agent actions inside
 * the MCP route handler: there a "use client" module's exports are client
 * references, not functions, so nothing they import, however deep, may be
 * one; nor React or the store. (The same walk as
 * test/lib/analytics/server-boundary.test.ts, over lib/quality.)
 */
const ROOT = process.cwd();
const ENTRIES = [
  "src/lib/quality/cost.ts",
  "src/lib/quality/pyramid.ts",
  "src/lib/quality/flaky.ts",
  "src/lib/quality/review.ts",
].map((f) => path.join(ROOT, f));
const BANNED_PACKAGES = ["react", "react-dom", "zustand", "lucide-react"];

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

describe("the quality libraries on the server", () => {
  it("import no client module, React or the store, directly or through another module", () => {
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
    // It did walk the libraries' imports (a broken walk would pass vacuously).
    expect(seen.size).toBeGreaterThan(ENTRIES.length + 3);
    for (const banned of BANNED_PACKAGES) expect(Array.from(packages)).not.toContain(banned);
  });
});
