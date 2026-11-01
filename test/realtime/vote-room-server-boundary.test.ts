// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The vote-room kit's logic (`src/lib/realtime/vote-room/index.ts`: the
 * protocol, the aggregates, and the pair and allocation kinds) is what the
 * Kano, Buy-a-Feature and $100 Test agent actions fold hand-entered rounds
 * with, inside the MCP route handler. There a "use client" module's exports
 * are client references, not functions, so nothing it imports, however
 * deep, may be one; nor React or the store. The client pieces (`crypto.ts`,
 * `use-vote-room.ts`) stay out of the index.
 */
const ROOT = process.cwd();
const ENTRY = path.join(ROOT, "src/lib/realtime/vote-room/index.ts");
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

describe("the vote-room kit's logic on the server", () => {
  it("imports no client module, React or the store, directly or through another module", () => {
    const seen = new Set<string>();
    const packages = new Set<string>();
    const queue = [ENTRY];
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
    const names = Array.from(seen, (f) => path.basename(f));
    // It walked the kit, the new kinds included (a broken walk would pass vacuously).
    for (const f of [
      "protocol.ts",
      "aggregate.ts",
      "pair.ts",
      "allocation.ts",
      "kinds.ts",
      "wire.ts",
    ]) {
      expect(names).toContain(f);
    }
    expect(names).not.toContain("use-vote-room.ts");
    expect(names).not.toContain("crypto.ts");
    for (const banned of BANNED_PACKAGES) expect(Array.from(packages)).not.toContain(banned);
  });
});
