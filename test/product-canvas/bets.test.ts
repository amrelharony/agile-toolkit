// @vitest-environment node
/**
 * The Shape Up pitch and the betting table (P2.3b): the appetite, a bet as
 * the page reads it, cycles (grouped by number, dated by their
 * earliest-decided bet, newest first), placing a bet (a known cycle's dates
 * taken, a conflict refused, a new cycle's start needed), a cycle's dates
 * changed for every bet in it, the circuit breaker with a `today` argument
 * (no fake timers), the columns, the pitch's gaps and the CRUD guard's bet
 * rules. Also the business case's decision and its gaps.
 */

import { describe, expect, it } from "vitest";
import {
  bettingTable,
  betColumn,
  circuitBreaker,
  cycleOf,
  cycles,
  nextCycleNumber,
  outOfTime,
  placeBet,
  withCycleDates,
} from "@/lib/product-canvas/bets";
import { cycleEnd, isOutOfTime, readBet, readWeeks } from "@/lib/product-canvas/fields";
import {
  canvasGaps,
  productCanvasWriteProblems,
  readCanvas,
  withAppetite,
  withBet,
  withDecision,
} from "@/lib/product-canvas/model";
import type { ProductCanvas, ProductPitchBet } from "@/lib/stores/workspace-types";

const NOW = "2026-11-23T10:00:00.000Z";
const LATER = "2026-11-23T11:00:00.000Z";
const TODAY = "2026-11-23";

const item = (id: string, text: string) => ({ id, text });

function pitch(
  id: string,
  bet?: ProductPitchBet,
  over: Partial<ProductCanvas> = {}
): ProductCanvas {
  return {
    id,
    format: "shape-up",
    title: `Pitch ${id}`,
    sections: {},
    ...(bet ? { bet } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const ok = <T extends { ok: boolean }>(w: T) => {
  if (!w.ok) throw new Error(`refused: ${JSON.stringify(w)}`);
  return w as Extract<T, { ok: true }>;
};

describe("a cycle's dates", () => {
  it("ends on its start plus its weeks, less a day", () => {
    expect(cycleEnd("2026-10-05", 6)).toBe("2026-11-15");
    expect(cycleEnd("2026-11-02", 1)).toBe("2026-11-08");
    expect(cycleEnd("2026-11-02", 13)).toBeNull();
    expect(cycleEnd("November", 2)).toBeNull();
    expect(cycleEnd(undefined, 2)).toBeNull();
  });

  it("is out of time the day after it ends, and only for a bet still running", () => {
    const bet: ProductPitchBet = { status: "bet", cycle: 4, start: "2026-10-05", weeks: 6 };
    expect(isOutOfTime(bet, "2026-11-15")).toBe(false);
    expect(isOutOfTime(bet, "2026-11-16")).toBe(true);
    expect(isOutOfTime({ ...bet, status: "shipped" }, "2026-12-01")).toBe(false);
    expect(circuitBreaker(pitch("p", bet), "2026-11-16")).toEqual({ due: true, end: "2026-11-15" });
    expect(circuitBreaker(pitch("p", bet), "2026-11-10")).toEqual({ due: false });
  });
});

describe("reading a pitch", () => {
  it("keeps a sound appetite and bet, and nothing of a pitch back on the table", () => {
    expect(readWeeks(6)).toBe(6);
    expect(readWeeks(0)).toBeUndefined();
    expect(readWeeks(2.5)).toBeUndefined();
    expect(
      readBet({ status: "bet", cycle: 4, start: "2026-10-05", weeks: 6, decidedAt: NOW })
    ).toEqual({ status: "bet", cycle: 4, start: "2026-10-05", weeks: 6, decidedAt: NOW });
    expect(readBet({ status: "table", cycle: 4, start: "2026-10-05", weeks: 6 })).toEqual({
      status: "table",
    });
    expect(readBet({ status: "won" })).toBeUndefined();
    expect(readBet({ status: "bet", cycle: 61, start: "soon", weeks: 13 })).toEqual({
      status: "bet",
    });
    const c = readCanvas({ ...pitch("p"), appetiteWeeks: 30, bet: { status: "passed" } })!;
    expect(c.appetiteWeeks).toBeUndefined();
    expect(c.bet).toEqual({ status: "passed" });
  });

  it("reads an appetite and a bet only on a Shape Up pitch", () => {
    const c = readCanvas({
      ...pitch("p", { status: "bet", cycle: 1, start: "2026-11-02", weeks: 2 }),
      format: "pr-faq",
      appetiteWeeks: 2,
    })!;
    expect(c).not.toHaveProperty("bet");
    expect(c).not.toHaveProperty("appetiteWeeks");
  });
});

describe("the appetite", () => {
  it("is set in whole weeks from 1 to 12, cleared with null, stamped", () => {
    const a = ok(withAppetite(pitch("p"), 2, LATER));
    expect(a.canvas).toMatchObject({ appetiteWeeks: 2, updatedAt: LATER });
    expect(ok(withAppetite(a.canvas, null, LATER)).canvas).not.toHaveProperty("appetiteWeeks");
    for (const bad of [0, 13, 2.5, Number.NaN]) {
      expect(withAppetite(pitch("p"), bad, LATER)).toMatchObject({
        ok: false,
        reason: "bad_field",
      });
    }
    expect(withAppetite({ ...pitch("p"), format: "idea" }, 2, LATER)).toMatchObject({
      ok: false,
      reason: "wrong_format",
    });
  });
});

describe("cycles", () => {
  const early = pitch("p1", {
    status: "bet",
    cycle: 4,
    start: "2026-10-05",
    weeks: 6,
    decidedAt: "2026-10-01T09:00:00Z",
  });
  const late = pitch("p2", {
    status: "shipped",
    cycle: 4,
    start: "2026-10-12",
    weeks: 2,
    decidedAt: "2026-10-03T09:00:00Z",
  });
  const five = pitch("p3", { status: "bet", cycle: 5, start: "2026-11-16", weeks: 6 });
  const onTable = pitch("p4");

  it("groups bets by number, newest first, dated by the earliest-decided bet", () => {
    const list = cycles([early, late, five, onTable]);
    expect(list.map((c) => c.number)).toEqual([5, 4]);
    expect(list[1]).toMatchObject({
      name: "Cycle 4",
      start: "2026-10-05",
      weeks: 6,
      end: "2026-11-15",
    });
    expect(list[1].bets.map((b) => b.id)).toEqual(["p1", "p2"]);
    expect(cycleOf([early, five], 4, "p1")).toBeUndefined();
    expect(nextCycleNumber([early, late, five])).toBe(6);
    expect(nextCycleNumber([])).toBe(1);
  });

  it("sorts every pitch into its column", () => {
    const t = bettingTable([early, late, five, onTable, pitch("p5", { status: "passed" })]);
    expect(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map((c) => c.id)]))).toEqual({
      table: ["p4"],
      bet: ["p1", "p3"],
      passed: ["p5"],
      done: ["p2"],
    });
    expect(betColumn(pitch("p", { status: "cut" }))).toBe("done");
    expect(betColumn(pitch("p"))).toBe("table");
  });

  it("lists the pitches out of time, the longest overdue first", () => {
    const old = pitch("p0", { status: "bet", cycle: 3, start: "2026-09-01", weeks: 2 });
    expect(outOfTime([early, five, old, late], TODAY).map((c) => c.id)).toEqual(["p0", "p1"]);
  });
});

describe("placing a bet", () => {
  const known = pitch("p1", {
    status: "bet",
    cycle: 4,
    start: "2026-10-05",
    weeks: 6,
    decidedAt: NOW,
  });
  const loose = pitch("p2");

  it("takes a known cycle's dates when they are left out, stamping when it was decided", () => {
    const w = ok(placeBet(loose, [known, loose], { status: "bet", cycle: 4 }, LATER));
    expect(w.canvas.bet).toEqual({
      status: "bet",
      cycle: 4,
      start: "2026-10-05",
      weeks: 6,
      decidedAt: LATER,
    });
    // The same dates, given: fine.
    expect(
      placeBet(
        loose,
        [known, loose],
        { status: "bet", cycle: 4, start: "2026-10-05", weeks: 6 },
        LATER
      ).ok
    ).toBe(true);
  });

  it("refuses dates that disagree with the cycle", () => {
    expect(
      placeBet(loose, [known, loose], { status: "bet", cycle: 4, weeks: 2 }, LATER)
    ).toMatchObject({
      ok: false,
      reason: "bad_bet",
      message: expect.stringMatching(/^Cycle 4 runs from 2026-10-05 for 6 weeks\./),
    });
  });

  it("needs a new cycle's start, and gives it six weeks unless told", () => {
    expect(placeBet(loose, [known, loose], { status: "bet", cycle: 5 }, LATER)).toMatchObject({
      ok: false,
      message: "Cycle 5 is new: say the day it starts.",
    });
    expect(
      ok(placeBet(loose, [known, loose], { status: "bet", cycle: 5, start: "2026-11-16" }, LATER))
        .canvas.bet
    ).toMatchObject({ cycle: 5, start: "2026-11-16", weeks: 6 });
    expect(placeBet(loose, [], { status: "bet" }, LATER)).toMatchObject({ reason: "bad_bet" });
    expect(
      placeBet(loose, [], { status: "bet", cycle: 61, start: "2026-11-16" }, LATER)
    ).toMatchObject({ reason: "bad_bet" });
    expect(placeBet(loose, [], { status: "bet", cycle: 1, start: "soon" }, LATER)).toMatchObject({
      reason: "bad_bet",
    });
  });

  it("keeps a pitch alone in its cycle on its own dates", () => {
    const alone = pitch("p9", { status: "passed", cycle: 7, start: "2026-12-07", weeks: 2 });
    expect(
      ok(placeBet(alone, [alone], { status: "bet", cycle: 7 }, LATER)).canvas.bet
    ).toMatchObject({
      status: "bet",
      cycle: 7,
      start: "2026-12-07",
      weeks: 2,
    });
  });

  it("keeps the cycle when passed on, shipped or cut, and clears it on the table", () => {
    const shipped = ok(placeBet(known, [known], { status: "shipped" }, LATER)).canvas;
    expect(shipped.bet).toMatchObject({
      status: "shipped",
      cycle: 4,
      start: "2026-10-05",
      weeks: 6,
    });
    const back = ok(placeBet(known, [known], { status: "table" }, LATER)).canvas;
    expect(back).not.toHaveProperty("bet");
  });

  it("stamps when it was decided only when the status or the cycle changes", () => {
    const again = ok(
      withBet(known, { status: "bet", cycle: 4, start: "2026-10-05", weeks: 6 }, LATER)
    );
    expect(again.canvas.bet?.decidedAt).toBe(NOW);
    const moved = ok(
      withBet(known, { status: "cut", cycle: 4, start: "2026-10-05", weeks: 6 }, LATER)
    );
    expect(moved.canvas.bet?.decidedAt).toBe(LATER);
  });

  it("is refused on a canvas that isn't a pitch, and for a bet with no cycle", () => {
    expect(placeBet({ ...loose, format: "idea" }, [], { status: "table" }, LATER)).toMatchObject({
      reason: "wrong_format",
    });
    expect(withBet(loose, { status: "bet" }, LATER)).toMatchObject({
      ok: false,
      reason: "bad_bet",
    });
  });
});

describe("changing a cycle's dates", () => {
  const a = pitch("p1", { status: "bet", cycle: 4, start: "2026-10-05", weeks: 6, decidedAt: NOW });
  const b = pitch("p2", {
    status: "shipped",
    cycle: 4,
    start: "2026-10-05",
    weeks: 6,
    decidedAt: LATER,
  });
  const c = pitch("p3", { status: "bet", cycle: 5, start: "2026-11-16", weeks: 6 });

  it("rewrites every bet in the cycle, and no other", () => {
    const r = withCycleDates([a, b, c], 4, { start: "2026-10-12", weeks: 4 }, LATER);
    if (!r.ok) throw new Error(r.message);
    expect(r.canvases.map((x) => [x.id, x.bet?.start, x.bet?.weeks])).toEqual([
      ["p1", "2026-10-12", 4],
      ["p2", "2026-10-12", 4],
    ]);
    expect(r.canvases.every((x) => x.updatedAt === LATER)).toBe(true);
  });

  it("refuses a cycle nobody bet on, a start that isn't a day and weeks out of range", () => {
    expect(withCycleDates([a], 9, { start: "2026-10-12", weeks: 4 }, LATER)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(withCycleDates([a], 4, { start: "next week", weeks: 4 }, LATER)).toMatchObject({
      reason: "bad_bet",
    });
    expect(withCycleDates([a], 4, { start: "2026-10-12", weeks: 13 }, LATER)).toMatchObject({
      reason: "bad_bet",
    });
  });
});

describe("a pitch's gaps", () => {
  it("asks for the appetite, rabbit holes and no-gos, and says when it is out of time", () => {
    const bare = pitch("p", { status: "bet", cycle: 4, start: "2026-10-05", weeks: 6 });
    const texts = canvasGaps(bare, { today: TODAY }).map((g) => g.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        '"The problem" is empty.',
        '"The solution" is empty.',
        "Set the appetite: how many weeks this problem is worth.",
        "Name the rabbit holes: the parts that could swallow the time.",
        "Say what's out: a pitch with no no-gos tends to grow.",
        "Its cycle ended on 2026-11-15. Out of time: ship what's done or cut it.",
      ])
    );
    const shaped: ProductCanvas = {
      ...bare,
      appetiteWeeks: 2,
      bet: { status: "shipped", cycle: 4, start: "2026-10-05", weeks: 6 },
      sections: {
        problem: [item("p", "Refunds need a call")],
        solution: [item("s", "A Refund button")],
        "rabbit-holes": [item("r", "Part refunds")],
        "no-gos": [item("n", "No old payments")],
      },
    };
    expect(canvasGaps(shaped, { today: TODAY })).toEqual([]);
  });
});

describe("the CRUD guard on a pitch", () => {
  it("passes a sound pitch, and refuses an appetite or a bet anywhere else", () => {
    const p = pitch(
      "p",
      { status: "bet", cycle: 4, start: "2026-10-05", weeks: 6 },
      { appetiteWeeks: 2 }
    );
    expect(productCanvasWriteProblems(p, null)).toEqual([]);
    expect(productCanvasWriteProblems({ ...p, format: "pr-faq" }, null)).toEqual(
      expect.arrayContaining(["A PR/FAQ has no appetiteWeeks.", "A PR/FAQ has no bet."])
    );
  });

  it("names a bet with no cycle, and a pitch on the table that keeps one", () => {
    expect(productCanvasWriteProblems(pitch("p", { status: "bet", cycle: 4 }), null)).toContain(
      "A bet needs its cycle, the day the cycle starts and its weeks."
    );
    expect(productCanvasWriteProblems(pitch("p", { status: "table", cycle: 4 }), null)).toContain(
      "A pitch on the table has no cycle: take the cycle out, or bet on it."
    );
    expect(productCanvasWriteProblems(pitch("p", { status: "passed" }), null)).toEqual([]);
  });
});

describe("a business case's decision", () => {
  const bizCase: ProductCanvas = {
    id: "pcanvas_case",
    format: "business-case",
    title: "Card-free shops",
    sections: {},
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("stamps the day it was decided when the verdict changes, and keeps it otherwise", () => {
    const go = ok(withDecision(bizCase, "go", "Worth a pilot", NOW)).canvas;
    expect(go.decision).toEqual({ verdict: "go", note: "Worth a pilot", decidedAt: NOW });
    const noted = ok(withDecision(go, "go", "Worth a six-week pilot", LATER)).canvas;
    expect(noted.decision).toEqual({
      verdict: "go",
      note: "Worth a six-week pilot",
      decidedAt: NOW,
    });
    const kept = ok(withDecision(noted, "change", undefined, LATER)).canvas;
    expect(kept.decision).toEqual({
      verdict: "change",
      note: "Worth a six-week pilot",
      decidedAt: LATER,
    });
    expect(ok(withDecision(kept, "change", null, LATER)).canvas.decision).not.toHaveProperty(
      "note"
    );
    expect(readCanvas(kept)?.decision).toEqual(kept.decision);
  });

  it("is refused anywhere but a business case, and for a note over its cap", () => {
    expect(withDecision({ ...bizCase, format: "shape-up" }, "go", undefined, NOW)).toMatchObject({
      ok: false,
      reason: "wrong_format",
    });
    expect(withDecision(bizCase, "go", "x".repeat(1001), NOW)).toMatchObject({
      reason: "too_long",
    });
  });

  it("asks for early signs, the smallest version and its cost", () => {
    const texts = canvasGaps(bizCase).map((g) => g.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        '"The epic" is empty.',
        '"What we expect" is empty.',
        "No early signs yet: say what you'd see in the first weeks if it works.",
        "Say the smallest version you could build to test it.",
        "Say what the smallest version costs, so the first go can be a small one.",
      ])
    );
    const full: ProductCanvas = {
      ...bizCase,
      sections: {
        epic: [item("e", "Card-free shops")],
        expect: [item("x", "Shops stop renting a machine")],
        signs: [item("s", "Ten pilots by week four")],
        mvp: [item("m", "Ten shops for six weeks")],
        "mvp-cost": [item("c", "Two people for six weeks")],
      },
    };
    expect(canvasGaps(full)).toEqual([]);
  });

  it("is checked by the CRUD guard only on a business case", () => {
    const decided = { ...bizCase, decision: { verdict: "go" as const } };
    expect(productCanvasWriteProblems(decided, null)).toEqual([]);
    expect(productCanvasWriteProblems({ ...decided, format: "lean-ux" }, null)).toContain(
      "A Lean UX canvas has no decision."
    );
  });
});
