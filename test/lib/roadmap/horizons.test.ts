// @vitest-environment node
/**
 * The Epic Roadmap's Now, Next, Later horizons (lib/roadmap/horizons), on
 * fixed dates: done first (even when set by hand), then a hand-set
 * horizon, then no valid quarters (Later), a started epic (Now), one
 * starting within two quarters (Next) and later ones (Later); the columns
 * keep the order given; the mismatch hint; a move never touches quarters;
 * and an epic sent from another tool moves from Next to Now when its
 * quarter starts.
 */

import { describe, expect, it } from "vitest";
import type { Epic } from "@/lib/stores/workspace-types";
import {
  HORIZON_LABEL,
  NEXT_WINDOW_QUARTERS,
  NOW_CROWDED,
  horizonColumns,
  horizonMismatch,
  horizonOf,
  isEpicHorizon,
  quartersHorizon,
  withHorizon,
} from "@/lib/roadmap/horizons";
import { buildEpicFromSource } from "@/lib/roadmap/epic-source";

/** 23 Nov 2026: the current quarter is 2026 Q4. */
const NOW = new Date("2026-11-23T12:00:00Z");

const epic = (start: string, end: string, over: Partial<Epic> = {}): Epic => ({
  id: `${start}-${end}`,
  title: "Epic",
  startQuarter: start,
  endQuarter: end,
  progress: 0,
  ...over,
});
const at = (e: Epic, done = false) => horizonOf({ epic: e, done }, NOW);

describe("horizonOf", () => {
  it("reads Now from a started epic, whether under way, ending or past its end", () => {
    expect(at(epic("2026 Q3", "2027 Q1"))).toEqual({ horizon: "now", from: "quarters" });
    expect(at(epic("2026 Q4", "2026 Q4")).horizon).toBe("now");
    expect(at(epic("2025 Q1", "2025 Q2")).horizon).toBe("now");
  });

  it("reads Next for a start within two quarters, Later past that", () => {
    expect(NEXT_WINDOW_QUARTERS).toBe(2);
    expect(at(epic("2027 Q1", "2027 Q2"))).toEqual({ horizon: "next", from: "quarters" });
    expect(at(epic("2027 Q2", "2027 Q2")).horizon).toBe("next");
    expect(at(epic("2027 Q3", "2027 Q4"))).toEqual({ horizon: "later", from: "quarters" });
  });

  it("puts an epic with no valid quarters in Later", () => {
    expect(at(epic("next spring", "later"))).toEqual({ horizon: "later", from: "none" });
    expect(at(epic("2027 Q2", "2027 Q1"))).toEqual({ horizon: "later", from: "none" });
  });

  it("takes a hand-set horizon over the quarters, and Done over both", () => {
    const moved = epic("2027 Q3", "2027 Q4", { horizon: "now" });
    expect(at(moved)).toEqual({ horizon: "now", from: "set" });
    expect(at(moved, true)).toEqual({ horizon: "done", from: "done" });
    expect(at(epic("2026 Q4", "2026 Q4"), true)).toEqual({ horizon: "done", from: "done" });
    // A stored horizon that isn't one reads as unset.
    expect(at(epic("2027 Q3", "2027 Q4", { horizon: "soon" as never })).from).toBe("quarters");
  });

  it("moves an epic sent from another tool from Next to Now when its quarter starts", () => {
    const sent = buildEpicFromSource(
      { title: "Refund button", sourceRef: { tool: "impact-map", id: "d1", doc: "m1" } },
      [],
      "e1",
      NOW
    );
    expect(sent).not.toHaveProperty("horizon");
    expect(horizonOf({ epic: sent, done: false }, NOW)).toEqual({
      horizon: "next",
      from: "quarters",
    });
    expect(horizonOf({ epic: sent, done: false }, new Date("2027-01-05T12:00:00Z")).horizon).toBe(
      "now"
    );
  });
});

describe("the board's helpers", () => {
  it("groups items by column in the order given", () => {
    const items = [
      { epic: epic("2027 Q3", "2027 Q4"), done: false, key: "a" },
      { epic: epic("2026 Q1", "2026 Q2"), done: false, key: "b" },
      { epic: epic("2027 Q1", "2027 Q1"), done: false, key: "c" },
      { epic: epic("2026 Q4", "2026 Q4"), done: true, key: "d" },
      { epic: epic("2026 Q4", "2027 Q1"), done: false, key: "e" },
    ];
    const cols = horizonColumns(items, NOW);
    expect(cols.now.map((i) => i.key)).toEqual(["b", "e"]);
    expect(cols.next.map((i) => i.key)).toEqual(["c"]);
    expect(cols.later.map((i) => i.key)).toEqual(["a"]);
    expect(cols.done.map((i) => i.key)).toEqual(["d"]);
    expect(horizonColumns([], NOW)).toEqual({ now: [], next: [], later: [], done: [] });
  });

  it("says when a hand-set horizon and the quarters disagree", () => {
    expect(
      horizonMismatch({ epic: epic("2027 Q3", "2027 Q4", { horizon: "now" }), done: false }, NOW)
    ).toBe("Its quarters put it in Later.");
    expect(
      horizonMismatch({ epic: epic("2026 Q4", "2026 Q4", { horizon: "now" }), done: false }, NOW)
    ).toBeNull();
    expect(horizonMismatch({ epic: epic("2027 Q3", "2027 Q4"), done: false }, NOW)).toBeNull();
    expect(
      horizonMismatch({ epic: epic("x", "y", { horizon: "now" }), done: false }, NOW)
    ).toBeNull();
    expect(
      horizonMismatch({ epic: epic("2027 Q3", "2027 Q4", { horizon: "now" }), done: true }, NOW)
    ).toBeNull();
  });

  it("sets or clears a horizon and never touches the quarters", () => {
    const e = epic("2027 Q3", "2027 Q4");
    const moved = withHorizon(e, "next");
    expect(moved).toEqual({ ...e, horizon: "next" });
    expect(e).not.toHaveProperty("horizon");
    expect(withHorizon(moved, null)).toEqual(e);
    expect(quartersHorizon(moved, NOW)).toEqual({ horizon: "later", from: "quarters" });
  });

  it("names the columns and the crowding line", () => {
    expect(HORIZON_LABEL).toEqual({ now: "Now", next: "Next", later: "Later", done: "Done" });
    expect(NOW_CROWDED).toBe(4);
    expect(isEpicHorizon("later")).toBe(true);
    expect(isEpicHorizon("done")).toBe(false);
  });
});
