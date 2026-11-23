// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Parking Lot's and Facilitator Timers' agent actions run inside the MCP
 * route handler, where a "use client" module's exports are client
 * references, not functions. So:
 *
 *   1. the libraries their MCP handlers call (the parking-lot model and
 *      rules, the hand-off link helpers, the timers' settings) import no
 *      client module, React DOM, zustand or the store, however deep;
 *   2. the action files themselves reach no client module but the
 *      workspace store (which every action reads in the browser and never
 *      calls on the server): not the whole hand-off registry, whose other
 *      targets reach browser-only stores and the toast, and not the docked
 *      timer, which the timers' browser handlers load only when they run.
 */
const ROOT = process.cwd();
const abs = (f: string) => path.join(ROOT, f);
const STORE = abs("src/lib/stores/workspace-store.ts");

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

const isClient = (src: string) => /^\s*["']use client["']/.test(src);

/** Every module reached from `entries`, stopping at the workspace store; and the packages. */
function walk(entries: readonly string[]) {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const clients: string[] = [];
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file === STORE) continue;
    const src = readFileSync(file, "utf8");
    if (isClient(src)) clients.push(path.relative(ROOT, file));
    for (const spec of valueImports(src)) {
      const next = resolve(spec, file);
      if (next) queue.push(next);
      else packages.add(spec);
    }
  }
  return { seen, packages, clients };
}

describe("what the MCP handlers call", () => {
  it("imports no client module, React DOM, zustand or the store", () => {
    const { seen, packages, clients } = walk(
      [
        "src/app/(tools)/estimation-guide/references.ts",
        "src/lib/analytics/distributions.ts",
        "src/lib/bug-triage/model.ts",
        "src/lib/estimation/async-pack.ts",
        "src/lib/estimation/similar.ts",
        "src/lib/estimation/three-point.ts",
        "src/lib/experiments/ab.ts",
        "src/lib/experiments/model.ts",
        "src/lib/parking-lot/model.ts",
        "src/lib/parking-lot/route-rules.ts",
        "src/lib/pi-planning/confidence.ts",
        "src/lib/pi-planning/model.ts",
        "src/lib/pi-planning/predictability.ts",
        "src/lib/pi-planning/roam.ts",
        "src/lib/handoffs/links.ts",
        "src/lib/example-mapping/model.ts",
        "src/lib/facilitator-timers/settings.ts",
        "src/lib/facilitator-timers/model.ts",
        "src/lib/facilitator-timers/sounds.ts",
        "src/lib/ebm/model.ts",
        "src/lib/ebm/sources.ts",
        "src/lib/flow/blocks.ts",
        "src/lib/flow/distribution.ts",
        "src/lib/flow/stability.ts",
        "src/lib/hill-chart/model.ts",
        "src/lib/hypotheses/value.ts",
        "src/lib/hypotheses/value-steps.ts",
        "src/lib/impediments/blockers.ts",
        "src/lib/impediments/clusters.ts",
        "src/lib/kanban/statik.ts",
        "src/lib/kanban/workflow.ts",
        "src/lib/notes-to-actions/due.ts",
        "src/lib/notes-to-actions/extract.ts",
        "src/lib/notes-to-actions/model.ts",
        "src/lib/personas/from-notes.ts",
        "src/lib/personas/interviews.ts",
        "src/lib/personas/model.ts",
        "src/lib/product-canvas/model.ts",
        "src/lib/product-canvas/starter.ts",
        "src/lib/product-metrics/model.ts",
        "src/lib/product-metrics/templates.ts",
        "src/lib/relative-sizing/model.ts",
        "src/lib/relative-sizing/state.ts",
        "src/lib/releases/notes-steps.ts",
        "src/lib/releases/notes.ts",
        "src/lib/roadmap/epic-source.ts",
        "src/lib/roadmap/horizons.ts",
        "src/lib/strategy-map/checks.ts",
        "src/lib/strategy-map/drafts.ts",
        "src/lib/strategy-map/formats.ts",
        "src/lib/strategy-map/model.ts",
        "src/lib/strategy-map/rules.ts",
        "src/lib/strategy-map/send.ts",
        "src/lib/test-sessions/model.ts",
        "src/lib/trees/parent-tree.ts",
      ].map(abs)
    );
    expect(clients).toEqual([]);
    expect(seen.has(STORE)).toBe(false);
    // It did walk the libraries (a broken walk would pass vacuously).
    expect(seen.size).toBeGreaterThan(6);
    for (const banned of ["react-dom", "zustand"]) {
      expect(Array.from(packages)).not.toContain(banned);
    }
  });
});

describe("the action files", () => {
  it.each([
    // One tool id per line, so tools added side by side merge cleanly.
    "ab-calculator",
    "bug-triage",
    "parking-lot",
    "pi-planning",
    "planning-poker",
    "ebm-dashboard",
    "example-mapping",
    "facilitator-timers",
    "epic-roadmap",
    "flow-insights",
    "hill-chart",
    "hypothesis-tracker",
    "impact-map",
    "impediments",
    "kanban",
    "notes-to-actions",
    "persona-library",
    "product-canvas",
    "product-metrics",
    "relative-sizing",
    "release-readiness",
    "strategy-tree",
    "test-sessions",
  ])("%s reaches no client module but the workspace store", (tool) => {
    const { seen, clients } = walk([abs(`src/lib/actions/tools/${tool}.ts`)]);
    expect(clients).toEqual([]);
    expect(seen.has(abs("src/lib/handoffs/registry.ts"))).toBe(false);
    expect(seen.has(abs("src/lib/timer/dock-timer.ts"))).toBe(false);
    expect(seen.has(abs("src/lib/facilitator-timers/store.ts"))).toBe(false);
    expect(seen.size).toBeGreaterThan(4);
  });
});
