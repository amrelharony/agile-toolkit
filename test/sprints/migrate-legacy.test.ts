/**
 * The one-time move of the old per-tool sprint stores (Burndown, Burnup,
 * Velocity, Sprint Comparison) into the shared sprints and series: what each
 * source becomes, what is skipped, how it merges with what the workspace
 * already holds, and the crash-safe write order (one write, backup, remove).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_SPRINT_KEYS,
  SPRINT_COMPARE_PINS_KEY,
  SPRINT_MIGRATION_LOCK,
  hasLegacySprintData,
  legacySprintId,
  migrateLegacySprintsNow,
  migrationSummary,
  planMigration,
  runLegacySprintMigration,
  type LegacyRaw,
  type LegacyWorkspace,
} from "@/lib/sprints/migrate-legacy";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useStorageHealth } from "@/lib/stores/storage-health";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";

const TODAY = "2026-10-08";
const NOW = "2026-10-08T09:00:00.000Z";

/** A zustand-persist blob, as the old stores saved them. */
function persisted(state: unknown): string {
  return JSON.stringify({ state, version: 0 });
}

const BURNDOWN = {
  config: { totalPoints: 30, sprintDays: 10, sprintStartDate: "2026-10-05" },
  entries: [
    { id: "default:day-0", day: 0, remaining: 30, scopeChange: false },
    { id: "default:day-1", day: 1, remaining: 28, scopeChange: false },
    { id: "u-2", day: 2, remaining: 31, scopeChange: true, description: "Card fix added" },
    { id: "default:day-3", day: 3, remaining: null, scopeChange: false },
  ],
};

const BURNUP = {
  config: { sprintDays: 10, sprintStartDate: "2026-10-05" },
  entries: [
    { id: "default:day-0", day: 0, scope: 30, completed: 0 },
    { id: "u-1", day: 1, scope: null, completed: 2 },
    { id: "u-2", day: 2, scope: 38, completed: 4, description: "Scope grew" },
    { id: "default:day-3", day: 3, scope: null, completed: null },
  ],
};

/** Burndown as a first visit left it (start date swapped to that day). */
function untouchedBurndown(start = "2026-09-01") {
  return {
    config: { totalPoints: 40, sprintDays: 10, sprintStartDate: start },
    entries: Array.from({ length: 11 }, (_, i) => ({
      id: `default:day-${i}`,
      day: i,
      remaining: i === 0 ? 40 : null,
      scopeChange: false,
    })),
  };
}

function untouchedBurnup() {
  return {
    config: { sprintDays: 10, sprintStartDate: "2026-01-01" },
    entries: Array.from({ length: 11 }, (_, i) => ({
      id: `default:day-${i}`,
      day: i,
      scope: i === 0 ? 40 : null,
      completed: i === 0 ? 0 : null,
    })),
  };
}

const COMPARE_SP1 = {
  id: "sp1",
  name: "Sprint 1",
  scores: {
    Velocity: 7,
    Quality: 6,
    "Scope Stability": 8,
    "Team Happiness": 7,
    "Goal Achievement": 8,
    Predictability: 6,
  },
};

function ratings(v: number) {
  return {
    Velocity: v,
    Quality: v,
    "Scope Stability": v,
    "Team Happiness": v,
    "Goal Achievement": v,
    Predictability: v,
  };
}

function sprint(over: Partial<Sprint> & { id: string }): Sprint {
  return {
    name: over.id,
    startDate: "2026-09-01",
    endDate: "2026-09-15",
    pointsPlanned: 20,
    status: "completed",
    ...over,
  };
}

const EMPTY: LegacyWorkspace = { sprints: [], sprintSeries: [] };

function plan(raw: LegacyRaw, ws: LegacyWorkspace = EMPTY) {
  return planMigration(raw, ws, TODAY, { now: NOW });
}

/** The workspace after applying a plan (what the shell's one write does). */
function applied(ws: LegacyWorkspace, p: ReturnType<typeof plan>): LegacyWorkspace {
  const up = <T extends { id: string }>(list: readonly T[], rows: T[]) => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const next = list.map((x) => byId.get(x.id) ?? x);
    for (const r of rows) if (!list.some((x) => x.id === r.id)) next.push(r);
    return next;
  };
  return { sprints: up(ws.sprints, p.sprints), sprintSeries: up(ws.sprintSeries ?? [], p.series) };
}

const startId = (date: string) => legacySprintId(`start:${date}`);
const nameId = (name: string) => legacySprintId(`name:${name}`);

describe("planMigration: each source", () => {
  it("Burndown becomes a dated sprint with its daily log", () => {
    const p = plan({ burndown: persisted(BURNDOWN) });
    const id = startId("2026-10-05");
    expect(id).toMatch(/^sprint_legacy_[0-9a-f]{8}$/);
    expect(p.sprints).toEqual([
      {
        id,
        name: "Sprint of 5 Oct 2026",
        startDate: "2026-10-05",
        endDate: "2026-10-15",
        pointsPlanned: 30,
        status: "active",
      },
    ]);
    expect(p.series).toEqual([
      {
        id,
        days: [
          { day: 0, remaining: 30 },
          { day: 1, remaining: 28 },
          // The flagged rise (28 -> 31) becomes the day's scope: 30 + 3.
          { day: 2, remaining: 31, scopeChange: true, note: "Card fix added", scope: 33 },
        ],
        migratedFrom: [LEGACY_SPRINT_KEYS.burndown],
        updatedAt: NOW,
      },
    ]);
    expect(p.report.created).toEqual([id]);
    expect(p.report.sources.burndown).toMatchObject({ present: true, moved: 1 });
  });

  it("a past sprint is completed, with no completed points guessed", () => {
    const old = { ...BURNDOWN, config: { ...BURNDOWN.config, sprintStartDate: "2026-06-01" } };
    const [s] = plan({ burndown: persisted(old) }).sprints;
    expect(s.status).toBe("completed");
    expect(s.pointsCompleted).toBeUndefined();
  });

  it("a future sprint is planned", () => {
    const later = { ...BURNDOWN, config: { ...BURNDOWN.config, sprintStartDate: "2026-11-02" } };
    expect(plan({ burndown: persisted(later) }).sprints[0].status).toBe("planned");
  });

  it("Burnup becomes a sprint planned at its day-0 scope", () => {
    const p = plan({ burnup: persisted(BURNUP) });
    const id = startId("2026-10-05");
    expect(p.sprints[0]).toMatchObject({ id, pointsPlanned: 30, endDate: "2026-10-15" });
    expect(p.series[0].days).toEqual([
      { day: 0, scope: 30, completed: 0 },
      { day: 1, completed: 2 },
      { day: 2, scope: 38, completed: 4, note: "Scope grew" },
    ]);
    expect(p.series[0].migratedFrom).toEqual([LEGACY_SPRINT_KEYS.burnup]);
  });

  it("Velocity rows keep their ids, with the old bridge's mapping", () => {
    const p = plan({
      velocity: persisted({
        sprints: [
          { id: "uuid-a", name: "Sprint 4", committed: 30, completed: 26, description: "Checkout" },
          { id: "uuid-b", name: "Sprint 5", committed: 32, completed: 0 },
        ],
      }),
    });
    expect(p.sprints).toEqual([
      {
        id: "uuid-a",
        name: "Sprint 4",
        startDate: "2020-01-01",
        endDate: "",
        goal: "Checkout",
        pointsPlanned: 30,
        pointsCompleted: 26,
        status: "completed",
      },
      {
        id: "uuid-b",
        name: "Sprint 5",
        startDate: "2020-01-02",
        endDate: "",
        pointsPlanned: 32,
        status: "planned",
      },
    ]);
    expect(p.series.map((s) => [s.id, s.migratedFrom])).toEqual([
      ["uuid-a", [LEGACY_SPRINT_KEYS.velocity]],
      ["uuid-b", [LEGACY_SPRINT_KEYS.velocity]],
    ]);
  });

  it("a Velocity row the workspace already has is left alone", () => {
    const existing = sprint({ id: "uuid-a", name: "Renamed", pointsPlanned: 99 });
    const p = plan(
      {
        velocity: persisted({
          sprints: [{ id: "uuid-a", name: "Sprint 4", committed: 30, completed: 26 }],
        }),
      },
      { sprints: [existing], sprintSeries: [] }
    );
    expect(p.sprints).toEqual([]);
    expect(p.series).toEqual([]);
  });

  it("an edited Velocity seed row moves under an id that isn't an example's", () => {
    const p = plan({
      velocity: persisted({
        sprints: [{ id: "example-sprint-2", name: "Sprint 2", committed: 30, completed: 25 }],
      }),
    });
    expect(p.sprints).toHaveLength(1);
    expect(p.sprints[0].id).toBe(legacySprintId("velocity:example-sprint-2"));
    expect(p.sprints[0]).toMatchObject({ name: "Sprint 2", pointsCompleted: 25 });
  });

  it("Sprint Comparison rows attach ratings by name, or become new sprints", () => {
    const ws: LegacyWorkspace = {
      sprints: [sprint({ id: "s-9", name: "Sprint 9" })],
      sprintSeries: [],
    };
    const p = plan(
      {
        compare: persisted({
          sprints: [
            { id: "c1", name: "  sprint   9 ", scores: ratings(6) },
            { id: "c2", name: "Hardening", scores: ratings(4) },
          ],
        }),
      },
      ws
    );
    expect(p.sprints).toEqual([
      {
        id: nameId("hardening"),
        name: "Hardening",
        startDate: "",
        endDate: "",
        pointsPlanned: 0,
        status: "completed",
      },
    ]);
    expect(p.series.find((s) => s.id === "s-9")?.ratings).toEqual(ratings(6));
    expect(p.series.find((s) => s.id === nameId("hardening"))?.ratings).toEqual(ratings(4));
    expect(p.compareRatingPins).toEqual(["s-9", nameId("hardening")]);
    expect(p.report.updated).toEqual(["s-9"]);
  });

  it("an ambiguous name goes to the sprint that started last", () => {
    const ws: LegacyWorkspace = {
      sprints: [
        sprint({ id: "old", name: "Sprint 3", startDate: "2026-03-02" }),
        sprint({ id: "new", name: "Sprint 3", startDate: "2026-09-07" }),
        sprint({ id: "mid", name: "Sprint 3", startDate: "2026-06-01" }),
      ],
    };
    const p = plan(
      { compare: persisted({ sprints: [{ id: "c", name: "Sprint 3", scores: ratings(8) }] }) },
      ws
    );
    expect(p.series.map((s) => s.id)).toEqual(["new"]);
    expect(p.sprints).toEqual([]);
  });

  it("pins follow the old row order, at most five, one per sprint", () => {
    const rows = ["A", "B", "a", "C", "D", "E", "F"].map((name, i) => ({
      id: `c${i}`,
      name,
      scores: ratings(5),
    }));
    const p = plan({ compare: persisted({ sprints: rows }) });
    expect(p.compareRatingPins).toEqual(["a", "b", "c", "d", "e"].map(nameId));
  });
});

describe("planMigration: skips", () => {
  it("skips untouched Burndown, Burnup, Velocity and Comparison defaults", () => {
    const p = plan({
      burndown: persisted(untouchedBurndown()),
      burnup: persisted(untouchedBurnup()),
      velocity: persisted({
        sprints: [
          { id: "example-sprint-1", name: "Sprint 1", committed: 34, completed: 28 },
          { id: "default:sprint-2", name: "Sprint 2", committed: 30, completed: 32 },
          { id: "uuid-0", name: "Sprint 4", committed: 0, completed: 0 },
        ],
      }),
      compare: persisted({ sprints: [COMPARE_SP1] }),
    });
    expect(p.sprints).toEqual([]);
    expect(p.series).toEqual([]);
    expect(p.compareRatingPins).toEqual([]);
    expect(p.report.sources.burndown).toMatchObject({ present: true, moved: 0, skipped: 1 });
    expect(p.report.sources.velocity.skipped).toBe(3);
    expect(p.report.sources.compare.skipped).toBe(1);
    expect(migrationSummary(p.report)).toBeNull();
  });

  it("skips Burndown's example (example- rows)", () => {
    const example = {
      config: { totalPoints: 40, sprintDays: 10, sprintStartDate: "2026-10-02" },
      entries: [40, 38, 33].map((remaining, day) => ({
        id: `example-day-${day}`,
        day,
        remaining,
        scopeChange: false,
        description: day === 2 ? "Fixed the flaky login test" : undefined,
      })),
    };
    expect(plan({ burndown: persisted(example) }).sprints).toEqual([]);
  });

  it("keeps the user's own Burndown days beside example ones, and only those", () => {
    const mixed = {
      config: { totalPoints: 40, sprintDays: 10, sprintStartDate: "2026-10-02" },
      entries: [
        { id: "example-day-1", day: 1, remaining: 38, scopeChange: false },
        { id: "u-7", day: 7, remaining: 12, scopeChange: false },
      ],
    };
    const p = plan({ burndown: persisted(mixed) });
    expect(p.series[0].days).toEqual([{ day: 7, remaining: 12 }]);
  });

  it("an edited Comparison default row is moved", () => {
    const edited = { ...COMPARE_SP1, scores: { ...COMPARE_SP1.scores, Quality: 9 } };
    const p = plan({ compare: persisted({ sprints: [edited] }) });
    expect(p.sprints.map((s) => s.name)).toEqual(["Sprint 1"]);
  });

  it("a Burndown with only its sprint set up (points, start) is moved", () => {
    const set = {
      ...untouchedBurndown("2026-10-05"),
      config: { totalPoints: 32, sprintDays: 10, sprintStartDate: "2026-10-05" },
    };
    expect(plan({ burndown: persisted(set) }).sprints[0]).toMatchObject({ pointsPlanned: 32 });
  });

  it("reports an unreadable key without failing the others", () => {
    const p = plan({ burndown: "{not json", burnup: persisted(BURNUP) });
    expect(p.report.sources.burndown).toMatchObject({ present: true, unreadable: true });
    expect(p.sprints).toHaveLength(1);
  });
});

describe("planMigration: merging", () => {
  it("Burndown and Burnup with the same start date fill one sprint", () => {
    const p = plan({ burndown: persisted(BURNDOWN), burnup: persisted(BURNUP) });
    const id = startId("2026-10-05");
    expect(p.sprints.map((s) => s.id)).toEqual([id]);
    expect(p.sprints[0].pointsPlanned).toBe(30);
    expect(p.series).toHaveLength(1);
    expect(p.series[0].days).toEqual([
      { day: 0, remaining: 30, scope: 30, completed: 0 },
      { day: 1, remaining: 28, completed: 2 },
      {
        day: 2,
        remaining: 31,
        scopeChange: true,
        note: "Card fix added · Scope grew",
        scope: 38,
        completed: 4,
      },
    ]);
    expect(p.series[0].migratedFrom).toEqual([
      LEGACY_SPRINT_KEYS.burndown,
      LEGACY_SPRINT_KEYS.burnup,
    ]);
    expect(migrationSummary(p.report)).toBe(
      "Moved 1 sprint from Burndown and Burnup into shared sprints"
    );
  });

  it("matches a workspace sprint by start date and only fills its gaps", () => {
    const existing = sprint({
      id: "real",
      name: "Sprint 12",
      startDate: "2026-10-05T00:00:00.000Z",
      endDate: "",
      pointsPlanned: 35,
      status: "active",
    });
    const series: SprintSeries = {
      id: "real",
      days: [
        { day: 1, remaining: 27, note: "Standup moved" },
        { day: 2, remaining: 31, note: "Card fix added" },
      ],
    };
    const p = plan(
      { burndown: persisted(BURNDOWN) },
      { sprints: [existing], sprintSeries: [series] }
    );
    expect(p.report.created).toEqual([]);
    expect(p.report.updated).toEqual(["real"]);
    // The end date was missing: filled. The plan (35) is the workspace's.
    expect(p.sprints).toEqual([{ ...existing, endDate: "2026-10-15" }]);
    expect(p.series[0].days).toEqual([
      { day: 0, remaining: 30 },
      { day: 1, remaining: 27, note: "Standup moved" },
      // Rise from 27 to 31 on the workspace's plan of 35.
      { day: 2, remaining: 31, note: "Card fix added", scopeChange: true, scope: 39 },
    ]);
    // Planned points 35 vs 30, day 1 remaining 27 vs 28.
    expect(p.report.conflicts).toBe(2);
  });

  it("gives a flagged rise a scope, but keeps a scope Burnup typed that day", () => {
    const burnup = {
      config: { sprintDays: 10, sprintStartDate: "2026-10-05" },
      entries: [
        { id: "u-0", day: 0, scope: 30, completed: 0 },
        { id: "u-2", day: 2, scope: 36, completed: 1 },
      ],
    };
    const both = plan({ burndown: persisted(BURNDOWN), burnup: persisted(burnup) });
    expect(both.series[0].days?.find((d) => d.day === 2)).toMatchObject({
      scopeChange: true,
      scope: 36,
    });
    // A flag without a rise adds nothing.
    const flat = {
      ...BURNDOWN,
      entries: [
        { id: "u-0", day: 0, remaining: 30, scopeChange: false },
        { id: "u-1", day: 1, remaining: 28, scopeChange: true },
      ],
    };
    expect(plan({ burndown: persisted(flat) }).series[0].days?.[1].scope).toBeUndefined();
  });

  it("appends a different legacy note to the workspace's", () => {
    const existing = sprint({ id: "real", startDate: "2026-10-05", endDate: "2026-10-15" });
    const p = plan(
      { burnup: persisted(BURNUP) },
      { sprints: [existing], sprintSeries: [{ id: "real", days: [{ day: 2, note: "Demo" }] }] }
    );
    expect(p.series[0].days?.find((d) => d.day === 2)?.note).toBe("Demo · Scope grew");
  });

  it("with several sprints on that start date, prefers the active one", () => {
    const ws: LegacyWorkspace = {
      sprints: [
        sprint({ id: "a", startDate: "2026-10-05", endDate: "2026-10-19", status: "planned" }),
        sprint({ id: "b", startDate: "2026-10-05", endDate: "2026-10-12", status: "active" }),
      ],
    };
    expect(plan({ burndown: persisted(BURNDOWN) }, ws).series[0].id).toBe("b");
  });

  it("fills ratings per dimension, keeping the workspace's", () => {
    const ws: LegacyWorkspace = {
      sprints: [sprint({ id: "s", name: "Sprint 2" })],
      sprintSeries: [{ id: "s", ratings: { Velocity: 3 } }],
    };
    const p = plan(
      { compare: persisted({ sprints: [{ id: "c", name: "Sprint 2", scores: ratings(9) }] }) },
      ws
    );
    expect(p.series[0].ratings).toEqual({ ...ratings(9), Velocity: 3 });
    expect(p.report.conflicts).toBe(1);
  });

  it("Comparison rows match sprints the same run created from Velocity", () => {
    const p = plan({
      velocity: persisted({
        sprints: [{ id: "uuid-a", name: "Sprint 4", committed: 30, completed: 26 }],
      }),
      compare: persisted({ sprints: [{ id: "c", name: "Sprint 4", scores: ratings(7) }] }),
    });
    expect(p.sprints.map((s) => s.id)).toEqual(["uuid-a"]);
    expect(p.series[0]).toMatchObject({
      id: "uuid-a",
      ratings: ratings(7),
      migratedFrom: [LEGACY_SPRINT_KEYS.velocity, LEGACY_SPRINT_KEYS.compare],
    });
    expect(p.compareRatingPins).toEqual(["uuid-a"]);
  });

  it("a second run is a no-op", () => {
    const raw: LegacyRaw = {
      burndown: persisted(BURNDOWN),
      burnup: persisted(BURNUP),
      velocity: persisted({
        sprints: [
          { id: "uuid-a", name: "Sprint 4", committed: 30, completed: 26 },
          { id: "example-sprint-2", name: "Sprint 2", committed: 30, completed: 25 },
        ],
      }),
      compare: persisted({
        sprints: [
          { id: "c1", name: "Sprint 4", scores: ratings(7) },
          { id: "c2", name: "", scores: ratings(2) },
          { id: "c3", name: "Hardening", scores: ratings(4) },
        ],
      }),
    };
    const first = plan(raw);
    expect(first.sprints.length).toBeGreaterThan(0);
    const again = plan(raw, applied(EMPTY, first));
    expect(again.sprints).toEqual([]);
    expect(again.series).toEqual([]);
    expect(again.report.created).toEqual([]);
    expect(again.report.updated).toEqual([]);
    expect(again.compareRatingPins).toEqual(first.compareRatingPins);
  });

  it("a second run still finds a created sprint the user renamed or redated", () => {
    const first = plan({ burndown: persisted(BURNDOWN) });
    const ws = applied(EMPTY, first);
    const moved: LegacyWorkspace = {
      ...ws,
      sprints: ws.sprints.map((s) => ({ ...s, name: "Mine", startDate: "2026-10-06" })),
    };
    const again = plan({ burndown: persisted(BURNDOWN) }, moved);
    expect(again.sprints).toEqual([]);
    expect(again.series).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/*  The I/O shell                                                              */
/* -------------------------------------------------------------------------- */

describe("migrateLegacySprintsNow", () => {
  beforeAll(async () => {
    await useWorkspaceStore.persist.rehydrate();
  });

  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.getState().resetWorkspace();
    useStorageHealth.setState({ writeFailed: false });
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function seedAll() {
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, persisted(BURNDOWN));
    localStorage.setItem(LEGACY_SPRINT_KEYS.burnup, persisted(BURNUP));
    localStorage.setItem(
      LEGACY_SPRINT_KEYS.velocity,
      persisted({ sprints: [{ id: "uuid-a", name: "Sprint 4", committed: 30, completed: 26 }] })
    );
    localStorage.setItem(
      LEGACY_SPRINT_KEYS.compare,
      persisted({ sprints: [{ id: "c1", name: "Sprint 4", scores: ratings(7) }] })
    );
  }

  /** Counts workspace writes during `fn`. */
  function writesDuring(fn: () => void): number {
    let n = 0;
    const off = useWorkspaceStore.subscribe(() => n++);
    try {
      fn();
    } finally {
      off();
    }
    return n;
  }

  it("writes everything in one go, backs up each key and removes it", () => {
    seedAll();
    const raw = localStorage.getItem(LEGACY_SPRINT_KEYS.burndown);
    let result!: ReturnType<typeof migrateLegacySprintsNow>;
    const writes = writesDuring(() => {
      result = migrateLegacySprintsNow({ today: TODAY });
    });
    expect(writes).toBe(1);
    const ws = useWorkspaceStore.getState();
    expect(ws.sprints.map((s) => s.id).sort()).toEqual([startId("2026-10-05"), "uuid-a"].sort());
    expect(ws.sprintSeries?.find((s) => s.id === "uuid-a")?.ratings).toEqual(ratings(7));
    for (const key of Object.values(LEGACY_SPRINT_KEYS)) {
      expect(localStorage.getItem(key)).toBeNull();
      expect(localStorage.getItem(`${key}:migrated`)).not.toBeNull();
    }
    expect(localStorage.getItem(`${LEGACY_SPRINT_KEYS.burndown}:migrated`)).toBe(raw);
    expect(result.removed).toHaveLength(4);
    expect(result.kept).toEqual([]);
    // It reached the saved workspace too, not just memory.
    expect(localStorage.getItem("agile-toolkit:workspace")).toContain("uuid-a");
    expect(hasLegacySprintData()).toBe(false);
  });

  it("seeds Sprint Comparison's pins only when it has none", () => {
    seedAll();
    migrateLegacySprintsNow({ today: TODAY });
    expect(JSON.parse(localStorage.getItem(SPRINT_COMPARE_PINS_KEY) ?? "null")).toEqual(["uuid-a"]);

    localStorage.setItem(SPRINT_COMPARE_PINS_KEY, JSON.stringify(["mine"]));
    localStorage.setItem(
      LEGACY_SPRINT_KEYS.compare,
      persisted({ sprints: [{ id: "c9", name: "Other", scores: ratings(3) }] })
    );
    migrateLegacySprintsNow({ today: TODAY });
    expect(JSON.parse(localStorage.getItem(SPRINT_COMPARE_PINS_KEY) ?? "null")).toEqual(["mine"]);
  });

  it("keeps an earlier backup and timestamps the new one", () => {
    localStorage.setItem(`${LEGACY_SPRINT_KEYS.burndown}:migrated`, "earlier");
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, persisted(BURNDOWN));
    const result = migrateLegacySprintsNow({ today: TODAY, now: () => 1_760_000_000_000 });
    expect(localStorage.getItem(`${LEGACY_SPRINT_KEYS.burndown}:migrated`)).toBe("earlier");
    const stamped = `${LEGACY_SPRINT_KEYS.burndown}:migrated:1760000000000`;
    expect(localStorage.getItem(stamped)).toBe(persisted(BURNDOWN));
    expect(result.backups[LEGACY_SPRINT_KEYS.burndown]).toBe(stamped);
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).toBeNull();
  });

  it("a full storage on the backup keeps the key, and the next load finishes", () => {
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, persisted(BURNDOWN));
    const full = new Proxy(localStorage, {
      get(target, prop) {
        if (prop === "setItem") {
          return (k: string, v: string) => {
            if (k.includes(":migrated")) throw new DOMException("full", "QuotaExceededError");
            target.setItem(k, v);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const first = migrateLegacySprintsNow({ storage: full, today: TODAY });
    expect(first.kept).toEqual([LEGACY_SPRINT_KEYS.burndown]);
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).not.toBeNull();
    // The data itself is already in the workspace.
    expect(useWorkspaceStore.getState().sprints.map((s) => s.id)).toEqual([startId("2026-10-05")]);

    let second!: ReturnType<typeof migrateLegacySprintsNow>;
    const writes = writesDuring(() => {
      second = migrateLegacySprintsNow({ today: TODAY });
    });
    expect(writes).toBe(0);
    expect(second.removed).toEqual([LEGACY_SPRINT_KEYS.burndown]);
    expect(useWorkspaceStore.getState().sprints).toHaveLength(1);
  });

  it("replays after a crash between the write and the removal without writing again", () => {
    seedAll();
    // The crash: the workspace write landed, nothing else did.
    const ws = useWorkspaceStore.getState();
    const raw: LegacyRaw = {};
    for (const [source, key] of Object.entries(LEGACY_SPRINT_KEYS)) {
      raw[source as keyof typeof LEGACY_SPRINT_KEYS] = localStorage.getItem(key);
    }
    const p = planMigration(raw, ws, TODAY);
    useWorkspaceStore.setState({ sprints: p.sprints, sprintSeries: p.series });
    const before = useWorkspaceStore.getState();

    let result!: ReturnType<typeof migrateLegacySprintsNow>;
    const writes = writesDuring(() => {
      result = migrateLegacySprintsNow({ today: TODAY });
    });
    expect(writes).toBe(0);
    expect(useWorkspaceStore.getState().sprints).toBe(before.sprints);
    expect(result.removed).toHaveLength(4);
    expect(migrationSummary(result.report)).toBeNull();
  });

  it("keeps the keys when the workspace couldn't be saved", () => {
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, persisted(BURNDOWN));
    useStorageHealth.setState({ writeFailed: true });
    const result = migrateLegacySprintsNow({ today: TODAY });
    expect(result.kept).toEqual([LEGACY_SPRINT_KEYS.burndown]);
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).not.toBeNull();
  });

  it("backs up and removes untouched defaults and unreadable keys too", () => {
    localStorage.setItem(LEGACY_SPRINT_KEYS.burnup, persisted(untouchedBurnup()));
    localStorage.setItem(LEGACY_SPRINT_KEYS.velocity, "{oops");
    const writes = writesDuring(() => {
      migrateLegacySprintsNow({ today: TODAY });
    });
    expect(writes).toBe(0);
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burnup)).toBeNull();
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.velocity)).toBeNull();
    expect(localStorage.getItem(`${LEGACY_SPRINT_KEYS.velocity}:migrated`)).toBe("{oops");
  });

  it("does nothing before the workspace has loaded", () => {
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, persisted(BURNDOWN));
    vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(false);
    const writes = writesDuring(() => {
      migrateLegacySprintsNow({ today: TODAY });
    });
    expect(writes).toBe(0);
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).not.toBeNull();
  });

  it("does nothing without old keys", () => {
    const result = migrateLegacySprintsNow({ today: TODAY });
    expect(result).toEqual({ report: null, removed: [], kept: [], backups: {} });
    expect(console.info).not.toHaveBeenCalled();
  });

  it("holds the cross-tab lock when the browser has one", async () => {
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, persisted(BURNDOWN));
    const request = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    const result = await runLegacySprintMigration({ today: TODAY });
    expect(request).toHaveBeenCalledWith(SPRINT_MIGRATION_LOCK, expect.any(Function));
    expect(result.removed).toEqual([LEGACY_SPRINT_KEYS.burndown]);
  });

  it("runs without the lock where there is none", async () => {
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, persisted(BURNDOWN));
    const result = await runLegacySprintMigration({ today: TODAY });
    expect(result.removed).toEqual([LEGACY_SPRINT_KEYS.burndown]);
  });
});

describe("migrationSummary", () => {
  it("names the tools data came from", () => {
    const p = plan({
      burndown: persisted(BURNDOWN),
      velocity: persisted({
        sprints: [{ id: "uuid-a", name: "Sprint 4", committed: 30, completed: 26 }],
      }),
      compare: persisted({ sprints: [{ id: "c", name: "Retro", scores: ratings(5) }] }),
    });
    expect(migrationSummary(p.report)).toBe(
      "Moved 3 sprints from Burndown, Velocity and Sprint Comparison into shared sprints"
    );
  });
});
