// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * lib/risks' model, legacy-register and scales, and lib/tech-debt's model
 * and legacy, are read by the tool.risk_register / tool.tech_debt agent
 * actions inside the MCP route handler (scales by any that quote a
 * rating). There a "use client" module's exports are client references,
 * not functions, so nothing they import, however deep, may be one; nor
 * React or the store. (store.ts in each is the browser half and is left
 * out.)
 */
const ROOT = process.cwd();
const ENTRIES = [
  "src/lib/risks/model.ts",
  "src/lib/risks/legacy-register.ts",
  "src/lib/risks/scales.ts",
  "src/lib/tech-debt/model.ts",
  "src/lib/tech-debt/legacy.ts",
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

describe("lib/risks and lib/tech-debt on the server", () => {
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
        expect(spec, `${rel} imports a browser store`).not.toMatch(/(risks|tech-debt)\/store/);
      }
    }
    // It did walk the libraries (a broken walk would pass vacuously).
    expect(seen.size).toBeGreaterThan(6);
    for (const banned of BANNED_PACKAGES) expect(Array.from(packages)).not.toContain(banned);
  });
});
