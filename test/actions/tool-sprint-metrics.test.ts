/**
 * tool.sprint_metrics.trend coverage.
 *
 *   1. registered as a read action with an MCP handler
 *   2. the page's trend (lib/sprints/trends) over the workspace rows, with
 *      each sprint reduced to what identifies it
 *   3. window: the default six, a number, "all"
 *   4. the MCP path reads the same rows and returns the same numbers
 *   5. the libs the trend, Sprint Comparison and Velocity actions compute
 *      with import no "use client" module, React or the store: in the MCP
 *      route handler a client module's exports are client references
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The MCP path lists rows from the server store: an in-memory list per kind.
const rows = vi.hoisted(() => new Map<string, unknown[]>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) => rows.get(kind) ?? []),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { sprintTrends } from "@/lib/sprints/trends";
import "@/lib/actions/tools/sprint-metrics";

function ctx(source: "agent" | "mcp" = "agent") {
  return { userId: "u", source, squadProfileIds: [] as string[] };
}

type Trend = {
  rows: {
    sprint: Record<string, string>;
    committed: number;
    completed: number | null;
    sayDo: { pct: number; grade: string } | null;
    carryOver: { count: number | null; points: number | null; source: string };
    scope: { added: number; removed: number; churnPct: number | null; source: string };
  }[];
  window: number | null;
  finishedCount: number;
  sayDo: { considered: number; met: number; meanPct: number | null };
  carryOver: { meanPoints: number | null; count: number };
  churn: { meanPct: number | null; count: number };
  trends: { sayDo: null | { trend: string; significant: boolean }; churn: unknown };
};

const sprint = (n: number, done: number): Sprint => ({
  id: `s${n}`,
  name: `Sprint ${n}`,
  startDate: new Date(Date.UTC(2026, 0, 5 + 14 * (n - 1))).toISOString().slice(0, 10),
  endDate: new Date(Date.UTC(2026, 0, 18 + 14 * (n - 1))).toISOString().slice(0, 10),
  goal: "Not in the output",
  pointsPlanned: 30,
  pointsCompleted: done,
  status: "completed",
});
const SPRINTS = [8, 7, 6, 5, 4, 3, 2, 1].map((n) => sprint(n, 22 + n));
const STORIES: Story[] = [
  {
    id: "carried",
    title: "Carried",
    points: 5,
    status: "todo",
    sprintId: "s8",
    sprintHistory: [
      { sprintId: "s7", at: "2026-03-30T12:00:00.000Z", points: 5 },
      { from: "s7", sprintId: "s8", at: "2026-04-12T12:00:00.000Z", points: 5, carriedOver: true },
    ],
  },
];
const SERIES: SprintSeries[] = [{ id: "s8", days: [{ day: 3, scope: 33 }] }];

describe("tool.sprint_metrics.trend", () => {
  beforeEach(() => {
    rows.clear();
    useWorkspaceStore.setState({ sprints: SPRINTS, stories: STORIES, sprintSeries: SERIES });
  });

  it("is a read action with an MCP handler", () => {
    const action = registry.get("tool.sprint_metrics.trend");
    expect(action?.category).toBe("read");
    expect(action?.mcpHandler).toBeTypeOf("function");
  });

  it("returns the page's trend over the last six finished sprints", async () => {
    const r = (await registry.get("tool.sprint_metrics.trend")!.handler({}, ctx())) as Trend;
    expect(r.rows.map((x) => x.sprint.id)).toEqual(["s3", "s4", "s5", "s6", "s7", "s8"]);
    expect(r.rows[0].sprint).toEqual({
      id: "s3",
      name: "Sprint 3",
      startDate: "2026-02-02",
      endDate: "2026-02-15",
    });
    expect(r).toMatchObject({ window: 6, finishedCount: 8 });
    const s7 = r.rows.find((x) => x.sprint.id === "s7")!;
    expect(s7.carryOver).toMatchObject({ count: 1, points: 5, source: "history" });
    const s8 = r.rows.find((x) => x.sprint.id === "s8")!;
    expect(s8.scope).toMatchObject({ added: 3, churnPct: 10, source: "log" });
    expect(s8.sayDo).toMatchObject({ pct: 100, grade: "met" });

    const page = sprintTrends({ sprints: SPRINTS, stories: STORIES, series: SERIES });
    expect(r.sayDo).toEqual(page.sayDo);
    expect(r.carryOver).toEqual(page.carryOver);
    expect(r.churn).toEqual(page.churn);
    expect(r.rows.map((x) => x.scope)).toEqual(page.rows.map((x) => x.scope));
    // Mann-Kendall from six sprints, not significant below ten.
    expect(r.trends.sayDo).toMatchObject({ significant: false });
  });

  it("takes a window, or all", async () => {
    const action = registry.get("tool.sprint_metrics.trend")!;
    const three = (await action.handler({ window: 3 }, ctx())) as Trend;
    expect(three.rows.map((x) => x.sprint.id)).toEqual(["s6", "s7", "s8"]);
    const all = (await action.handler({ window: "all" }, ctx())) as Trend;
    expect(all.rows).toHaveLength(8);
    expect(all.window).toBeNull();
    expect(action.paramsSchema.safeParse({ window: 0 }).success).toBe(false);
  });

  it("reads the same rows over MCP", async () => {
    rows.set("workspace:sprint", SPRINTS);
    rows.set("workspace:story", STORIES);
    rows.set("workspace:sprintSeries", SERIES);
    const action = registry.get("tool.sprint_metrics.trend")!;
    const browser = await action.handler({ window: "all" }, ctx());
    useWorkspaceStore.setState({ sprints: [], stories: [], sprintSeries: [] });
    const mcp = await action.mcpHandler!({ window: "all" }, ctx("mcp"));
    expect(mcp).toEqual(browser);
  });

  it("says nothing finished yet with an empty workspace", async () => {
    useWorkspaceStore.setState({ sprints: [], stories: [], sprintSeries: [] });
    const r = (await registry.get("tool.sprint_metrics.trend")!.handler({}, ctx())) as Trend;
    expect(r.rows).toEqual([]);
    expect(r.sayDo.meanPct).toBeNull();
    expect(r.trends.sayDo).toBeNull();
  });
});

/* ── On the server ──────────────────────────────────────────────────── */

const ROOT = process.cwd();

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

describe("the trend libs on the server", () => {
  it.each([
    "src/lib/sprints/trends.ts",
    "src/lib/sprints/compare.ts",
    "src/lib/sprints/capacity.ts",
  ])("%s imports no client module, React or the store, however deep", (entry) => {
    const seen = new Set<string>();
    const packages = new Set<string>();
    const queue = [path.join(ROOT, entry)];
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
    // It did walk the library (a broken walk would pass vacuously).
    expect(seen.size).toBeGreaterThan(3);
    for (const banned of ["react", "react-dom", "zustand", "lucide-react"]) {
      expect(Array.from(packages)).not.toContain(banned);
    }
  });
});
