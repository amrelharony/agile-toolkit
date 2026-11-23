// @vitest-environment node
/**
 * Hill Chart's pure model, with an injected `now`: the hill's shape, the
 * sides, one check-in per local day (the oldest dropped past the cap), what
 * moved since a check-in, the stuck rule, a story that disagrees, a move
 * stamping movedAt and doneAt, reading stored rows defensively, and the
 * next steps.
 */

import { describe, expect, it } from "vitest";
import {
  CHECK_IN_DAYS,
  STUCK_DAYS,
  checkIn,
  clampPosition,
  daysSinceMove,
  hillChartSteps,
  hillY,
  isStuck,
  lastCheckIn,
  movement,
  movementText,
  moveScope,
  newScope,
  positionText,
  readHillChart,
  readHillCharts,
  reachedDone,
  scopeMismatch,
  scopeSource,
  sideOf,
  stuckScopes,
} from "@/lib/hill-chart/model";
import { TOOL_LIST_MAX, type HillChart, type HillScope } from "@/lib/stores/workspace-types";

const NOW = new Date(2026, 10, 23, 15, 0, 0);
const DAY = 86_400_000;
const ago = (days: number, from = NOW) => new Date(from.getTime() - days * DAY).toISOString();

const scope = (id: string, position: number, movedDaysAgo = 0, over: Partial<HillScope> = {}) => ({
  id,
  title: `Scope ${id}`,
  position,
  movedAt: ago(movedDaysAgo),
  ...over,
});
const chart = (over: Partial<HillChart> = {}): HillChart => ({
  id: "hill_a",
  title: "Refunds",
  scopes: [scope("s1", 20, 1), scope("s2", 60, 2)],
  checkIns: [],
  createdAt: ago(30),
  updatedAt: ago(1),
  ...over,
});

describe("the hill", () => {
  it("is flat at the feet and highest in the middle", () => {
    expect(hillY(0)).toBeCloseTo(0);
    expect(hillY(1)).toBeCloseTo(0);
    expect(hillY(0.5)).toBeCloseTo(1);
    expect(hillY(0.25)).toBeCloseTo(0.5);
  });

  it("reads below 50 as uphill, 50 to 99 downhill, 100 done", () => {
    expect(sideOf(0)).toBe("uphill");
    expect(sideOf(49)).toBe("uphill");
    expect(sideOf(50)).toBe("downhill");
    expect(sideOf(99)).toBe("downhill");
    expect(sideOf(100)).toBe("done");
    expect(positionText("Payment API", 30)).toBe("Payment API: 30, uphill");
  });

  it("clamps a position to a whole number from 0 to 100", () => {
    expect(clampPosition(42.6)).toBe(43);
    expect(clampPosition(-5)).toBe(0);
    expect(clampPosition(250)).toBe(100);
    expect(clampPosition("x")).toBe(0);
  });
});

describe("check-ins", () => {
  it("saves every scope's position with the note", () => {
    const next = checkIn(chart(), NOW, "  Moving along  ", "hcheck_1");
    expect(next.checkIns).toEqual([
      {
        id: "hcheck_1",
        at: NOW.toISOString(),
        positions: [
          { scopeId: "s1", position: 20 },
          { scopeId: "s2", position: 60 },
        ],
        note: "Moving along",
      },
    ]);
  });

  it("keeps one per local day: a second the same day replaces the first, keeping its id", () => {
    const morning = new Date(2026, 10, 23, 9, 0, 0);
    const first = checkIn(chart(), morning, "Morning", "hcheck_1");
    const moved = moveScope(first, "s1", 45, NOW.toISOString());
    const second = checkIn(moved, NOW, undefined, "hcheck_2");
    expect(second.checkIns).toHaveLength(1);
    expect(second.checkIns[0].id).toBe("hcheck_1");
    expect(second.checkIns[0].positions[0]).toEqual({ scopeId: "s1", position: 45 });
    expect(second.checkIns[0].note).toBeUndefined();
  });

  it("drops the oldest past the cap", () => {
    let c = chart();
    for (let i = TOOL_LIST_MAX.hillCheckIns + 2; i >= 1; i--) {
      c = checkIn(c, new Date(NOW.getTime() - i * 7 * DAY), `week ${i}`, `c${i}`);
    }
    expect(c.checkIns).toHaveLength(TOOL_LIST_MAX.hillCheckIns);
    expect(c.checkIns[0].id).toBe(`c${TOOL_LIST_MAX.hillCheckIns}`);
    expect(lastCheckIn(c)?.id).toBe("c1");
  });
});

describe("movement since a check-in", () => {
  it("says forward, back, not moved or new, and ignores removed scopes", () => {
    const c = chart({
      scopes: [scope("s1", 40), scope("s2", 50), scope("s3", 70), scope("s4", 10)],
    });
    const since = {
      id: "c",
      at: ago(7),
      positions: [
        { scopeId: "s1", position: 20 },
        { scopeId: "s2", position: 60 },
        { scopeId: "s3", position: 70 },
        { scopeId: "gone", position: 90 },
      ],
    };
    const moves = movement(c, since);
    expect(moves.map((m) => [m.scopeId, m.direction])).toEqual([
      ["s1", "forward"],
      ["s2", "back"],
      ["s3", "unmoved"],
      ["s4", "new"],
    ]);
    expect(moves.map(movementText)).toEqual([
      "forward 20",
      "back 10",
      "not moved",
      "new since then",
    ]);
  });

  it("calls everything new with no check-in", () => {
    expect(movement(chart(), undefined).every((m) => m.direction === "new")).toBe(true);
  });
});

describe("the stuck rule", () => {
  it("is uphill and not moved for 7 days or more", () => {
    expect(isStuck(scope("a", 30, STUCK_DAYS), NOW)).toBe(true);
    expect(isStuck(scope("a", 30, STUCK_DAYS - 1), NOW)).toBe(false);
    expect(isStuck(scope("a", 50, 30), NOW)).toBe(false);
    expect(isStuck(scope("a", 100, 30), NOW)).toBe(false);
  });

  it("lists the longest unmoved first", () => {
    const c = chart({ scopes: [scope("a", 10, 8), scope("b", 20, 12), scope("c", 70, 40)] });
    expect(stuckScopes(c, NOW).map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("counts days by local day", () => {
    const late = new Date(2026, 10, 22, 23, 30).toISOString();
    expect(daysSinceMove({ movedAt: late }, new Date(2026, 10, 23, 0, 15))).toBe(1);
    expect(daysSinceMove({ movedAt: "not a time" }, NOW)).toBe(0);
  });
});

describe("a linked story that disagrees", () => {
  it("flags a done story on an uphill scope, and an open story on a done scope", () => {
    expect(scopeMismatch({ position: 30 }, { status: "done" })).toBe("story-done-uphill");
    expect(scopeMismatch({ position: 100 }, { status: "in_progress" })).toBe(
      "scope-done-story-open"
    );
    expect(scopeMismatch({ position: 70 }, { status: "done" })).toBeNull();
    expect(scopeMismatch({ position: 30 }, undefined)).toBeNull();
  });
});

describe("moving a scope", () => {
  it("stamps movedAt, and doneAt on reaching 100 (cleared below it)", () => {
    const at = NOW.toISOString();
    const done = moveScope(chart(), "s2", 100, at);
    expect(done.scopes[1]).toMatchObject({ position: 100, movedAt: at, doneAt: at });
    const back = moveScope(done, "s2", 80, at);
    expect(back.scopes[1].doneAt).toBeUndefined();
    expect(reachedDone(60, 100)).toBe(true);
    expect(reachedDone(100, 100)).toBe(false);
  });

  it("returns the same chart when nothing changes", () => {
    const c = chart();
    expect(moveScope(c, "s1", 20, NOW.toISOString())).toBe(c);
    expect(moveScope(c, "missing", 50, NOW.toISOString())).toBe(c);
  });

  it("makes a new scope within its caps", () => {
    const s = newScope({ title: "  API  ", position: 140, note: "n" }, "hscope_1", "t");
    expect(s).toEqual({
      id: "hscope_1",
      title: "API",
      position: 100,
      movedAt: "t",
      note: "n",
      doneAt: "t",
    });
  });
});

describe("reading stored rows", () => {
  it("clamps positions, drops unreadable scopes and check-ins, and keeps the order", () => {
    const read = readHillChart({
      id: "hill_x",
      title: "X",
      createdAt: ago(3),
      scopes: [
        { id: "a", title: "A", position: 33.3, movedAt: ago(1) },
        { id: "b", position: 10 },
        { id: "c", title: "C", position: 120 },
        "junk",
      ],
      checkIns: [{ id: "c1", at: ago(2), positions: [{ scopeId: "a", position: 500 }] }, { at: 1 }],
    });
    expect(read?.scopes.map((s) => [s.id, s.position])).toEqual([
      ["a", 33],
      ["c", 100],
    ]);
    expect(read?.scopes[1].movedAt).toBe(ago(3));
    expect(read?.checkIns).toEqual([
      { id: "c1", at: ago(2), positions: [{ scopeId: "a", position: 100 }] },
    ]);
    expect(readHillChart({ id: "x" })).toBeNull();
    expect(
      readHillCharts([
        { id: "a", title: "A", createdAt: ago(5) },
        null,
        { id: "b", title: "B", createdAt: ago(1) },
      ]).map((c) => c.id)
    ).toEqual(["b", "a"]);
  });
});

describe("raising a stuck scope", () => {
  it("hands over its title, how long it sat uphill, its note, and where it lives", () => {
    const src = scopeSource(chart(), scope("s1", 20, 9, { note: "Waiting on the provider." }), NOW);
    expect(src).toEqual({
      title: "Scope s1",
      description:
        "Stuck on the uphill side of the hill chart “Refunds”: it hasn't moved for 9 days.\nWaiting on the provider.",
      sourceRef: { tool: "hill-chart", id: "s1", doc: "hill_a" },
    });
  });
});

describe("next steps", () => {
  it("asks about the longest-stuck scope", () => {
    const steps = hillChartSteps(
      {
        charts: [
          chart({
            scopes: [scope("a", 10, 8), scope("b", 20, 12, { title: "Payment API" })],
            checkIns: [{ id: "c", at: ago(1), positions: [] }],
          }),
        ],
      },
      NOW
    );
    expect(steps).toEqual([
      {
        id: "hill-chart-stuck",
        label: "Ask what is holding “Payment API” on the uphill side",
        detail: "It hasn't moved for 12 days on “Refunds”.",
        href: "/hill-chart?chart=hill_a",
      },
    ]);
  });

  it("asks for a check-in after a week without one", () => {
    const c = chart({ checkIns: [{ id: "c", at: ago(CHECK_IN_DAYS), positions: [] }] });
    expect(hillChartSteps({ charts: [c] }, NOW).map((s) => s.id)).toEqual(["hill-chart-check-in"]);
    const fresh = chart({ checkIns: [{ id: "c", at: ago(2), positions: [] }] });
    expect(hillChartSteps({ charts: [fresh] }, NOW)).toEqual([]);
  });

  it("leaves out the example's and archived charts, and charts with no scopes", () => {
    const old = { checkIns: [], createdAt: ago(20), scopes: [scope("a", 10, 9)] };
    expect(
      hillChartSteps(
        {
          charts: [
            chart({ ...old, id: "example-hill" }),
            chart({ ...old, id: "hill_b", archived: true }),
            chart({ id: "hill_c", scopes: [], createdAt: ago(20) }),
          ],
        },
        NOW
      )
    ).toEqual([]);
    expect(hillChartSteps({ charts: undefined }, NOW)).toEqual([]);
  });
});
