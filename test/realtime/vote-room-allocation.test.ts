import { describe, expect, it } from "vitest";
import {
  VOTE_LIMITS,
  VOTE_ROOM_EVENTS,
  VOTE_ROOM_TOOLS,
  VOTE_ROUND_KIND,
  isAllocationRoomTool,
  isPairRoomTool,
  isScaleRoomTool,
  readBallotEnvelope,
  readVoteState,
  signingInput,
  voteMinNFloor,
} from "@/lib/realtime/vote-room/protocol";
import { emptyLedger, type FoldContext } from "@/lib/realtime/vote-room/aggregate";
import {
  addAllocation,
  allocationAmount,
  allocationBandEdges,
  allocationCiphertextChars,
  allocationDraftProblem,
  allocationItemMax,
  allocationMean,
  allocationRoundMarkdown,
  amountWidth,
  bandAt,
  bandLabel,
  bandOf,
  bandRange,
  canRevealAllocation,
  cappedTotal,
  emptyAllocationTally,
  encodeAllocation,
  foldAllocation,
  foldAllocationTotals,
  middleHalf,
  middleHalfText,
  readAllocationState,
  readAllocationString,
  revealAllocation,
  sheetProblem,
  toAllocationResult,
  toWireSheet,
  type AllocationSheet,
  type AllocationStateBody,
  type AllocationTally,
} from "@/lib/realtime/vote-room/allocation";
import {
  ALLOCATION_SHEET,
  BUY_SHEET,
  ROUND,
  allocationStateBody,
  allocationString,
  stateBody,
} from "./vote-room-fixtures";

/**
 * Allocation rounds (Buy-a-Feature, the $100 Test): the sheet checks, the
 * fixed-size split encoding, the state reader (exactly what a host builds,
 * nothing a hostile one could slip in), signing, the fold, the reveal and
 * spread rules, the saved result and the statistics.
 */

const HOST = "host_00000000000";
const KEYS = { publicKeys: { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` } };
const SIG = "s".repeat(86);

function wire(body: AllocationStateBody, extra: Record<string, unknown> = {}) {
  return JSON.parse(JSON.stringify({ ...body, sig: SIG, ...extra })) as Record<string, unknown>;
}

function ctx(over: Partial<FoldContext> = {}): FoldContext {
  return {
    open: true,
    roundId: ROUND,
    admitted: new Set(["a", "b", "c", "d", "e", "f", HOST]),
    removed: new Set(),
    ...over,
  };
}

/** A tally with `splits` folded in, through the same path the host uses. */
function tallyOf(sheet: AllocationSheet, splits: number[][]): AllocationTally {
  let t = emptyAllocationTally(ROUND, sheet);
  for (const s of splits) {
    const next = addAllocation(t, s, sheet);
    if (!next) throw new Error(`refused split ${s.join(",")}`);
    t = next;
  }
  return t;
}

const FIVE = [
  [40, 30, 20, 10],
  [100, 0, 0, 0],
  [25, 25, 25, 25],
  [0, 50, 50, 0],
  [10, 20, 30, 40],
];

describe("kinds", () => {
  it("VOTE_ROUND_KIND covers every vote tool, and the guards follow it", () => {
    expect(Object.keys(VOTE_ROUND_KIND).sort()).toEqual([...VOTE_ROOM_TOOLS].sort());
    expect(VOTE_ROUND_KIND).toEqual({
      "health-check": "scale",
      "psych-safety": "scale",
      "mood-tracker": "scale",
      "kano-model": "pair",
      "buy-a-feature": "allocation",
      "hundred-dollar-test": "allocation",
    });
    for (const t of VOTE_ROOM_TOOLS) {
      expect([isScaleRoomTool(t), isPairRoomTool(t), isAllocationRoomTool(t)]).toEqual([
        VOTE_ROUND_KIND[t] === "scale",
        VOTE_ROUND_KIND[t] === "pair",
        VOTE_ROUND_KIND[t] === "allocation",
      ]);
    }
    for (const t of ["retro", "moscow", "", null, 1]) {
      expect(isAllocationRoomTool(t)).toBe(false);
      expect(isPairRoomTool(t)).toBe(false);
      expect(isScaleRoomTool(t)).toBe(false);
    }
  });

  it("gives the new tools the default floor of 3", () => {
    expect(voteMinNFloor("buy-a-feature")).toBe(3);
    expect(voteMinNFloor("hundred-dollar-test")).toBe(3);
    expect(voteMinNFloor("kano-model")).toBe(3);
  });

  it("readVoteState refuses an allocation tool's state, even a v1-shaped one", () => {
    const v1 = JSON.parse(
      JSON.stringify({ ...stateBody(HOST, KEYS as never), tool: "hundred-dollar-test", sig: SIG })
    );
    expect(readVoteState(v1, "hundred-dollar-test")).toBeNull();
  });

  it("readAllocationState refuses a scale tool, a v1 body, and a pair kind", () => {
    const body = allocationStateBody(HOST, KEYS);
    expect(readAllocationState(wire(body), "hundred-dollar-test")).not.toBeNull();
    expect(readAllocationState(wire(body), "health-check" as never)).toBeNull();
    expect(
      readAllocationState(wire(body, { tool: "health-check" }), "health-check" as never)
    ).toBeNull();
    expect(readAllocationState(wire(body, { v: 1 }), "hundred-dollar-test")).toBeNull();
    expect(readAllocationState(wire(body, { kind: "pair" }), "hundred-dollar-test")).toBeNull();
    expect(readAllocationState(wire(body, { kind: undefined }), "hundred-dollar-test")).toBeNull();
    // Another allocation tool's state is not this page's.
    expect(readAllocationState(wire(body), "buy-a-feature")).toBeNull();
    // A scale state never reads as an allocation one.
    const scale = JSON.parse(JSON.stringify({ ...stateBody(HOST, KEYS as never), sig: SIG }));
    expect(readAllocationState(scale, "hundred-dollar-test")).toBeNull();
  });
});

describe("the sheet", () => {
  it("rebuilds a sheet field by field", () => {
    expect(toWireSheet(ALLOCATION_SHEET)).toEqual(ALLOCATION_SHEET);
    expect(toWireSheet(BUY_SHEET)).toEqual(BUY_SHEET);
    const messy = {
      ...ALLOCATION_SHEET,
      title: "  Where \n would\u202e you  put $100?  ",
      items: ALLOCATION_SHEET.items.map((x, i) =>
        i === 0 ? { ...x, text: " Sea\u202erch ", hint: "  " } : x
      ),
    };
    const out = toWireSheet(messy)!;
    expect(out.title).toBe("Where would you put $100?");
    expect(out.items[0]).toEqual({ id: "search", text: "Search" });
  });

  it.each<[string, Partial<AllocationSheet>, RegExp]>([
    ["a budget under 10", { budget: 9 }, /whole number from 10 to 9,999/],
    ["a budget over 9,999", { budget: 10_000 }, /whole number from 10 to 9,999/],
    ["a fractional budget", { budget: 99.5 }, /whole number/],
    ["a unit over 4 characters", { unit: "dollars" }, /at most 4 characters/],
    ["a missing spendAll", { spendAll: undefined as never }, /whole budget/],
    ["one item", { items: [{ id: "a", text: "A" }] }, /2 to 20 items/],
    [
      "21 items",
      { items: Array.from({ length: 21 }, (_, i) => ({ id: `i${i}`, text: `Item ${i}` })) },
      /2 to 20 items/,
    ],
    [
      "duplicate ids",
      {
        items: [
          { id: "a", text: "A" },
          { id: "a", text: "B" },
        ],
      },
      /same id as an earlier item/,
    ],
    [
      "a blank item",
      {
        items: [
          { id: "a", text: "A" },
          { id: "b", text: "  " },
        ],
      },
      /Item 2 needs text/,
    ],
    [
      "a bad id",
      {
        items: [
          { id: "a b", text: "A" },
          { id: "b", text: "B" },
        ],
      },
      /Item 1's id/,
    ],
    [
      "a cap of 0",
      {
        items: [
          { id: "a", text: "A", cap: 0 },
          { id: "b", text: "B" },
        ],
      },
      /cap needs to be a whole number from 1 to 1,000,000/,
    ],
    [
      "a cap over a million",
      {
        items: [
          { id: "a", text: "A", cap: 1_000_001 },
          { id: "b", text: "B" },
        ],
      },
      /cap needs/,
    ],
    [
      "caps that can't take the whole budget",
      {
        spendAll: true,
        items: [
          { id: "a", text: "A", cap: 40 },
          { id: "b", text: "B", cap: 50 },
        ],
      },
      /caps add up to less than the budget/,
    ],
    ["no title", { title: "  " }, /needs a title/],
  ])("refuses %s, saying why", (_label, over, problem) => {
    const sheet = { ...ALLOCATION_SHEET, ...over } as AllocationSheet;
    expect(toWireSheet(sheet)).toBeNull();
    expect(sheetProblem(sheet)).toMatch(problem);
  });

  it("accepts 20 items on a 9,999 budget: 80 bytes, the most there is", () => {
    const sheet: AllocationSheet = {
      ...ALLOCATION_SHEET,
      budget: 9_999,
      items: Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, text: `Item ${i}` })),
    };
    expect(sheetProblem(sheet)).toBeNull();
    expect(sheet.items.length * amountWidth(sheet.budget)).toBe(VOTE_LIMITS.maxAllocationBytes);
  });

  it("allows an empty unit and words as units", () => {
    expect(sheetProblem({ ...ALLOCATION_SHEET, unit: "" })).toBeNull();
    expect(sheetProblem({ ...ALLOCATION_SHEET, unit: "pts" })).toBeNull();
  });
});

describe("splits on the wire", () => {
  it("are fixed-width zero-padded digits, the width of the budget", () => {
    expect(amountWidth(10)).toBe(2);
    expect(amountWidth(100)).toBe(3);
    expect(amountWidth(9_999)).toBe(4);
    expect(
      encodeAllocation({ search: 40, export: 30, sso: 20, themes: 10 }, ALLOCATION_SHEET)
    ).toBe("040030020010");
    // Blank (null or missing) is 0.
    expect(encodeAllocation({ search: 100, export: null }, ALLOCATION_SHEET)).toBe("100000000000");
  });

  it("round-trip random splits through the string", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let n = 0; n < 200; n++) {
      // A random split of exactly 100 across four items.
      const cuts = [0, 100, ...Array.from({ length: 3 }, () => Math.floor(rand() * 101))].sort(
        (a, b) => a - b
      );
      const amounts = cuts.slice(1).map((c, i) => c - cuts[i]);
      const draft = Object.fromEntries(ALLOCATION_SHEET.items.map((x, i) => [x.id, amounts[i]]));
      const plain = encodeAllocation(draft, ALLOCATION_SHEET);
      expect(plain).toHaveLength(12);
      expect(readAllocationString(plain!, ALLOCATION_SHEET)).toEqual(amounts);
    }
  });

  it.each<[string, string]>([
    ["a non-digit", "04003002001a"],
    ["a sign", "-40030020010"],
    ["a space", " 40030020010"],
    ["too short", "04003002001"],
    ["too long", "0400300200100"],
    ["under the budget, when it must all be given", "040030020000"],
    ["over the budget", "040030020020"],
    ["nothing at all", "000000000000"],
    ["one item over the budget", "101000000000"],
  ])("readAllocationString refuses %s", (_label, plain) => {
    expect(readAllocationString(plain, ALLOCATION_SHEET)).toBeNull();
  });

  it("respects caps per person and allows less than the budget when not spending it all", () => {
    expect(readAllocationString(allocationString([30, 0, 0], 2), BUY_SHEET)).toEqual([30, 0, 0]);
    expect(readAllocationString(allocationString([20, 30, 0], 2), BUY_SHEET)).toEqual([20, 30, 0]);
    // Exports is capped at 30.
    expect(readAllocationString(allocationString([0, 31, 0], 2), BUY_SHEET)).toBeNull();
    // A cap above the budget never lets one person give more than the budget.
    expect(allocationItemMax(BUY_SHEET.items[2], BUY_SHEET.budget)).toBe(50);
    expect(readAllocationString(allocationString([0, 0, 51], 2), BUY_SHEET)).toBeNull();
  });

  it("allocationDraftProblem names the first thing wrong", () => {
    expect(allocationDraftProblem({ search: 100 }, ALLOCATION_SHEET)).toBeNull();
    expect(allocationDraftProblem({ search: 1.5 }, ALLOCATION_SHEET)).toEqual({
      itemId: "search",
      problem: "not-whole",
    });
    expect(allocationDraftProblem({ export: -1 }, ALLOCATION_SHEET)).toEqual({
      itemId: "export",
      problem: "not-whole",
    });
    expect(allocationDraftProblem({ export: 31 }, BUY_SHEET)).toEqual({
      itemId: "export",
      problem: "over-cap",
    });
    expect(allocationDraftProblem({ sso: 51 }, BUY_SHEET)).toEqual({
      itemId: "sso",
      problem: "over-budget",
    });
    expect(allocationDraftProblem({}, ALLOCATION_SHEET)).toEqual({ problem: "empty" });
    expect(allocationDraftProblem({ search: 60, export: 50 }, ALLOCATION_SHEET)).toEqual({
      problem: "over-budget",
    });
    expect(allocationDraftProblem({ search: 60 }, ALLOCATION_SHEET)).toEqual({
      problem: "under-budget",
    });
    expect(allocationDraftProblem({ search: 10 }, BUY_SHEET)).toBeNull();
    expect(encodeAllocation({ search: 60 }, ALLOCATION_SHEET)).toBeNull();
  });

  it("has one ciphertext size per sheet, inside the envelope reader's bounds", () => {
    expect(allocationCiphertextChars(ALLOCATION_SHEET)).toBe(Math.ceil(((12 + 16) * 4) / 3));
    const biggest: AllocationSheet = {
      ...ALLOCATION_SHEET,
      budget: 9_999,
      items: Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, text: `Item ${i}` })),
    };
    expect(allocationCiphertextChars(biggest)).toBe(VOTE_LIMITS.maxCiphertextChars);
    const smallest: AllocationSheet = {
      ...ALLOCATION_SHEET,
      budget: 10,
      items: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
    };
    expect(allocationCiphertextChars(smallest)).toBe(27);
    // Both ends pass the unchanged envelope reader.
    for (const n of [27, 128]) {
      const env = {
        v: 1,
        by: "alice_0000000000",
        roundId: ROUND,
        bid: "bid_00000001",
        epk: `B${"E".repeat(86)}`,
        iv: "i".repeat(16),
        ct: "c".repeat(n),
      };
      expect(readBallotEnvelope(env)).not.toBeNull();
    }
  });
});

describe("bands", () => {
  it.each<[number, number[]]>([
    [10, [0, 1, 2, 3, 6]],
    [11, [0, 1, 2, 3, 6]],
    [100, [0, 1, 11, 26, 51]],
    [9_999, [0, 1, 1000, 2500, 5000]],
  ])("budget %i has edges %j, strictly rising", (budget, edges) => {
    expect(allocationBandEdges(budget)).toEqual(edges);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });

  it("are rising for every budget from 10 to 9,999", () => {
    for (let b = VOTE_LIMITS.minBudget; b <= VOTE_LIMITS.maxBudget; b++) {
      const e = allocationBandEdges(b);
      for (let i = 1; i < e.length; i++) expect(e[i]).toBeGreaterThan(e[i - 1]);
    }
  });

  it("bandOf, bandRange and bandLabel agree: 0 | ≤10% | ≤25% | ≤50% | >50%", () => {
    const e = allocationBandEdges(100);
    expect([0, 1, 10, 11, 25, 26, 50, 51, 100].map((a) => bandOf(a, e))).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
    expect(bandRange(4, e, 100)).toEqual([51, 100]);
    expect([0, 1, 2, 3, 4].map((k) => bandLabel(k, e, 100, "$"))).toEqual([
      "$0",
      "$1–$10",
      "$11–$25",
      "$26–$50",
      "$51–$100",
    ]);
  });
});

describe("folding", () => {
  it("adds a split to totals and bands, never mutating, and refuses what the reader refuses", () => {
    const t = emptyAllocationTally(ROUND, ALLOCATION_SHEET);
    const before = JSON.stringify(t);
    const next = addAllocation(t, [40, 30, 20, 10], ALLOCATION_SHEET)!;
    expect(JSON.stringify(t)).toBe(before);
    expect(next.totals).toEqual([40, 30, 20, 10]);
    expect(next.bands).toEqual([
      [0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0],
      [0, 0, 1, 0, 0],
      [0, 1, 0, 0, 0],
    ]);
    expect(next.ballots).toBe(1);
    expect(addAllocation(t, [40, 30, 20], ALLOCATION_SHEET)).toBeNull();
    expect(addAllocation(t, [40, 30, 20, 9], ALLOCATION_SHEET)).toBeNull();
    expect(addAllocation(t, [40.5, 30, 20, 9.5], ALLOCATION_SHEET)).toBeNull();
    expect(addAllocation(t, [0, 0, 0, 0], ALLOCATION_SHEET)).toBeNull();
    // A tally for another sheet.
    expect(addAllocation(t, [10, 0, 0], BUY_SHEET)).toBeNull();
  });

  it("foldAllocation runs the scale pre-checks and records who answered", () => {
    const t = emptyAllocationTally(ROUND, ALLOCATION_SHEET);
    const ledger = emptyLedger();
    const ok = foldAllocation(t, ledger, "a", [100, 0, 0, 0], ALLOCATION_SHEET, ctx());
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ledger.voted.size).toBe(0);
    expect(ok.ledger.voted.has("a")).toBe(true);
    const again = foldAllocation(ok.tally, ok.ledger, "a", [100, 0, 0, 0], ALLOCATION_SHEET, ctx());
    expect(again).toEqual({ ok: false, reason: "duplicate" });
    expect(
      foldAllocation(t, ledger, "a", [100, 0, 0, 0], ALLOCATION_SHEET, ctx({ open: false }))
    ).toEqual({ ok: false, reason: "closed" });
    expect(foldAllocation(t, ledger, "zed", [100, 0, 0, 0], ALLOCATION_SHEET, ctx())).toEqual({
      ok: false,
      reason: "not-admitted",
    });
    expect(
      foldAllocation(
        t,
        ledger,
        "a",
        [100, 0, 0, 0],
        ALLOCATION_SHEET,
        ctx({ removed: new Set(["a"]) })
      )
    ).toEqual({ ok: false, reason: "removed" });
    expect(foldAllocation(t, ledger, "a", [50, 0, 0, 0], ALLOCATION_SHEET, ctx())).toEqual({
      ok: false,
      reason: "bad-answers",
    });
    const full = { ...t, ballots: VOTE_LIMITS.maxBallotsPerRound };
    expect(foldAllocation(full, ledger, "a", [100, 0, 0, 0], ALLOCATION_SHEET, ctx())).toEqual({
      ok: false,
      reason: "round-full",
    });
  });

  it("foldAllocationTotals takes hand totals that valid splits could give, and loses the spread", () => {
    const t = emptyAllocationTally(ROUND, ALLOCATION_SHEET);
    const ok = foldAllocationTotals(t, [175, 125, 125, 75], 5, ALLOCATION_SHEET)!;
    expect(ok.totals).toEqual([175, 125, 125, 75]);
    expect(ok.ballots).toBe(5);
    expect(ok.spreadKnown).toBe(false);
    // spendAll: they must add up to people × budget.
    expect(foldAllocationTotals(t, [175, 125, 125, 74], 5, ALLOCATION_SHEET)).toBeNull();
    // One item can't get more than people × its cap (or budget).
    expect(foldAllocationTotals(t, [501, 0, 0, 0], 5, ALLOCATION_SHEET)).toBeNull();
    expect(foldAllocationTotals(t, [1, 2], 5, ALLOCATION_SHEET)).toBeNull();
    expect(foldAllocationTotals(t, [100, 100, 100, 100.5], 4, ALLOCATION_SHEET)).toBeNull();
    expect(foldAllocationTotals(t, [100, 100, 100, 100], 0, ALLOCATION_SHEET)).toBeNull();
    // Buy-a-Feature: up to people × budget, at least one each, caps per person.
    const b = emptyAllocationTally(ROUND, BUY_SHEET);
    expect(foldAllocationTotals(b, [100, 90, 50], 5, BUY_SHEET)).not.toBeNull();
    expect(foldAllocationTotals(b, [100, 151, 0], 5, BUY_SHEET)).toBeNull(); // Exports cap 30 × 5
    expect(foldAllocationTotals(b, [2, 0, 0], 5, BUY_SHEET)).toBeNull(); // everyone gave something
    expect(foldAllocationTotals(b, [250, 0, 1], 5, BUY_SHEET)).toBeNull(); // over 5 × 50
    expect(
      foldAllocationTotals(b, [1, 0, 0], VOTE_LIMITS.maxTallyBallots + 1, BUY_SHEET)
    ).toBeNull();
  });
});

describe("the reveal rules", () => {
  it("needs minN ballots, then shows every total; the spread only from 5", () => {
    const three = tallyOf(ALLOCATION_SHEET, FIVE.slice(0, 3));
    expect(canRevealAllocation(tallyOf(ALLOCATION_SHEET, FIVE.slice(0, 2)), 3)).toBe(false);
    expect(revealAllocation(tallyOf(ALLOCATION_SHEET, FIVE.slice(0, 2)), 3)).toBeNull();
    expect(canRevealAllocation(three, 3)).toBe(true);
    expect(revealAllocation(three, 3)).toEqual([
      { total: 165, backers: null, bands: null },
      { total: 55, backers: null, bands: null },
      { total: 45, backers: null, bands: null },
      { total: 35, backers: null, bands: null },
    ]);
    const four = tallyOf(ALLOCATION_SHEET, FIVE.slice(0, 4));
    expect(revealAllocation(four, 3)!.every((r) => r.bands === null && r.backers === null)).toBe(
      true
    );
    const five = tallyOf(ALLOCATION_SHEET, FIVE);
    expect(revealAllocation(five, 3)).toEqual([
      { total: 175, backers: 4, bands: [1, 1, 1, 1, 1] },
      { total: 125, backers: 4, bands: [1, 0, 2, 2, 0] },
      { total: 125, backers: 4, bands: [1, 0, 2, 2, 0] },
      { total: 75, backers: 3, bands: [2, 1, 1, 1, 0] },
    ]);
    // A higher minN holds the spread back with the totals.
    expect(revealAllocation(five, 6)).toBeNull();
  });

  it("never shows the spread of totals typed by hand, however many people", () => {
    const t = foldAllocationTotals(
      emptyAllocationTally(ROUND, ALLOCATION_SHEET),
      [300, 300, 200, 200],
      10,
      ALLOCATION_SHEET
    )!;
    expect(revealAllocation(t, 3)!.every((r) => r.bands === null && r.backers === null)).toBe(true);
  });

  it("toAllocationResult re-applies the rules and holds no ids", () => {
    const five = tallyOf(ALLOCATION_SHEET, FIVE);
    const revealed = revealAllocation(five, 3)!;
    const meta = {
      tool: "hundred-dollar-test" as const,
      roundId: ROUND,
      closedAt: "2026-10-26T10:00:00.000Z",
      minN: 3,
      ballots: 5,
      source: "live" as const,
    };
    const r = toAllocationResult(ALLOCATION_SHEET, revealed, meta)!;
    expect(r).toMatchObject({
      kind: "allocation",
      tool: "hundred-dollar-test",
      sheetId: "hundred:round",
      budget: 100,
      unit: "$",
      spendAll: true,
      ballots: 5,
      minN: 3,
      source: "live",
      bandEdges: [0, 1, 11, 26, 51],
    });
    expect(r.items[0]).toEqual({
      id: "search",
      text: "Search",
      total: 175,
      backers: 4,
      bands: [1, 1, 1, 1, 1],
    });
    expect(JSON.stringify(r)).not.toMatch(/voted|ledger|acks|alice|host_/);
    // A caller claiming 4 ballots can't save the spread of 5.
    const four = toAllocationResult(ALLOCATION_SHEET, revealed, { ...meta, ballots: 4 })!;
    expect(four.items.every((x) => x.bands === null && x.backers === null)).toBe(true);
    // Under minN there is nothing to save.
    expect(toAllocationResult(ALLOCATION_SHEET, revealed, { ...meta, ballots: 2 })).toBeNull();
    // The minN never drops under the tool's floor.
    expect(toAllocationResult(ALLOCATION_SHEET, revealed, { ...meta, minN: 1 })!.minN).toBe(3);
    // Caps travel with the items.
    const buy = toAllocationResult(
      BUY_SHEET,
      [
        { total: 70, backers: null, bands: null },
        { total: 40, backers: null, bands: null },
        { total: 10, backers: null, bands: null },
      ],
      { ...meta, tool: "buy-a-feature", ballots: 3 }
    )!;
    expect(buy.items.map((x) => x.cap)).toEqual([60, 30, 120]);
  });
});

describe("readAllocationState", () => {
  const five = tallyOf(ALLOCATION_SHEET, FIVE);
  const revealed = revealAllocation(five, 3)!;
  const shown = () =>
    allocationStateBody(HOST, KEYS, { phase: "revealed", ballots: 5, revealed: revealed });

  it("accepts exactly what the host builds, open and revealed, field for field", () => {
    const open = allocationStateBody(HOST, KEYS, { ballots: 2, acks: ["bid_00000001"] });
    expect(readAllocationState(wire(open), "hundred-dollar-test")).toEqual({ ...open, sig: SIG });
    const revealedBody = shown();
    expect(readAllocationState(wire(revealedBody), "hundred-dollar-test")).toEqual({
      ...revealedBody,
      sig: SIG,
    });
    const three = revealAllocation(tallyOf(ALLOCATION_SHEET, FIVE.slice(0, 3)), 3)!;
    const body = allocationStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 3,
      revealed: three,
    });
    expect(readAllocationState(wire(body), "hundred-dollar-test")).toEqual({ ...body, sig: SIG });
    const buy = allocationStateBody(HOST, KEYS, { tool: "buy-a-feature", sheet: BUY_SHEET });
    expect(readAllocationState(wire(buy), "buy-a-feature")).toEqual({ ...buy, sig: SIG });
  });

  it("drops unknown fields", () => {
    const raw = wire(allocationStateBody(HOST, KEYS), { extra: "x" });
    (raw.sheet as Record<string, unknown>).extra = 1;
    ((raw.sheet as { items: Record<string, unknown>[] }).items[0] as Record<string, unknown>).x = 2;
    const read = readAllocationState(raw, "hundred-dollar-test")!;
    expect(read).not.toHaveProperty("extra");
    expect(read.sheet).not.toHaveProperty("extra");
    expect(read.sheet.items[0]).toEqual({ id: "search", text: "Search" });
  });

  it("refuses anything over 20,000 characters, and non-objects", () => {
    const big = wire(allocationStateBody(HOST, KEYS), { pad: "x".repeat(20_000) });
    expect(readAllocationState(big, "hundred-dollar-test")).toBeNull();
    for (const v of [null, [], "state", 5])
      expect(readAllocationState(v, "hundred-dollar-test")).toBeNull();
  });

  it.each<[string, (r: Record<string, unknown>) => void]>([
    ["a budget out of range", (r) => ((r.sheet as Record<string, unknown>).budget = 5)],
    ["a fractional budget", (r) => ((r.sheet as Record<string, unknown>).budget = 99.5)],
    ["a long unit", (r) => ((r.sheet as Record<string, unknown>).unit = "dollar")],
    [
      "a unit with a control character",
      (r) => ((r.sheet as Record<string, unknown>).unit = "$\u0007"),
    ],
    ["a non-boolean spendAll", (r) => ((r.sheet as Record<string, unknown>).spendAll = "yes")],
    ["one item", (r) => ((r.sheet as { items: unknown[] }).items.length = 1)],
    ["a cap of 0", (r) => ((r.sheet as { items: Record<string, unknown>[] }).items[0].cap = 0)],
    [
      "duplicate item ids",
      (r) => ((r.sheet as { items: Record<string, unknown>[] }).items[1].id = "search"),
    ],
    [
      "text with a bidi override",
      (r) => ((r.sheet as { items: Record<string, unknown>[] }).items[0].text = "Se\u202erch"),
    ],
    ["a revealed result while open", (r) => (r.revealed = [])],
    ["a minN under the floor", (r) => (r.minN = 2)],
    ["more ballots than the round allows", (r) => (r.ballots = VOTE_LIMITS.maxBallotsPerRound + 1)],
    ["a bad ack", (r) => (r.acks = ["short"])],
    ["no signature", (r) => delete r.sig],
  ])("refuses %s", (_label, mutate) => {
    const raw = wire(allocationStateBody(HOST, KEYS));
    mutate(raw);
    expect(readAllocationState(raw, "hundred-dollar-test")).toBeNull();
  });

  it.each<[string, (rows: Record<string, unknown>[], r: Record<string, unknown>) => void]>([
    ["totals over ballots × budget on one item", (rows) => (rows[0].total = 501)],
    [
      "totals that don't add up to people × budget when it must all be given",
      (rows) => {
        rows[0].total = 174;
        rows[1].total = 126 - 1;
      },
    ],
    [
      "bands under 5 answers",
      (_rows, r) => {
        r.ballots = 4;
      },
    ],
    ["bands that don't add up to the ballots", (rows) => (rows[0].bands = [1, 1, 1, 1, 2])],
    ["four bands", (rows) => (rows[0].bands = [1, 1, 1, 2])],
    ["backers that aren't ballots minus the zero band", (rows) => (rows[0].backers = 5)],
    [
      "backers without bands",
      (rows) => {
        rows[0].bands = null;
      },
    ],
    [
      "bands on some items only",
      (rows) => {
        rows[0].bands = null;
        rows[0].backers = null;
      },
    ],
    [
      "a total the bands can't give",
      (rows) => {
        rows[3].total = 90;
        rows[0].total = 160;
      },
    ],
    [
      "a total under what the bands need",
      (rows) => {
        rows[0].total = 1;
        rows[1].total = 299;
      },
    ],
    ["a missing item", (rows) => rows.pop()],
    ["a non-integer total", (rows) => (rows[0].total = 175.5)],
  ])("refuses revealed results with %s", (_label, mutate) => {
    const raw = wire(shown());
    mutate(raw.revealed as Record<string, unknown>[], raw);
    expect(readAllocationState(raw, "hundred-dollar-test")).toBeNull();
  });

  it("refuses a reveal below minN, or one with acks", () => {
    const three = revealAllocation(tallyOf(ALLOCATION_SHEET, FIVE.slice(0, 3)), 3)!;
    const body = allocationStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 3,
      revealed: three,
    });
    expect(readAllocationState(wire(body, { ballots: 2 }), "hundred-dollar-test")).toBeNull();
    expect(
      readAllocationState(wire(body, { acks: ["bid_00000001"] }), "hundred-dollar-test")
    ).toBeNull();
    expect(readAllocationState(wire(body, { revealed: null }), "hundred-dollar-test")).toBeNull();
  });

  it("refuses a Buy-a-Feature amount over a cap: a total over people × cap", () => {
    const body = allocationStateBody(HOST, KEYS, {
      tool: "buy-a-feature",
      sheet: BUY_SHEET,
      phase: "revealed",
      ballots: 3,
      revealed: [
        { total: 30, backers: null, bands: null },
        { total: 91, backers: null, bands: null },
        { total: 0, backers: null, bands: null },
      ],
    });
    expect(readAllocationState(wire(body), "buy-a-feature")).toBeNull();
    const fine = {
      ...body,
      revealed: [
        { ...body.revealed![0] },
        { total: 90, backers: null, bands: null },
        body.revealed![2],
      ],
    };
    expect(readAllocationState(wire(fine), "buy-a-feature")).not.toBeNull();
  });
});

describe("signingInput for allocation states", () => {
  const body = allocationStateBody(HOST, KEYS);

  it("is stable whatever the key order", () => {
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(body).reverse()))
    ) as AllocationStateBody;
    expect(signingInput(VOTE_ROOM_EVENTS.state, reordered)).toBe(
      signingInput(VOTE_ROOM_EVENTS.state, body)
    );
  });

  it("changes with any sheet field and with the results", () => {
    const base = signingInput(VOTE_ROOM_EVENTS.state, body);
    const variants: AllocationStateBody[] = [
      { ...body, sheet: { ...body.sheet, budget: 99 } },
      { ...body, sheet: { ...body.sheet, unit: "€" } },
      { ...body, sheet: { ...body.sheet, spendAll: false } },
      { ...body, sheet: { ...body.sheet, title: "Other" } },
      {
        ...body,
        sheet: {
          ...body.sheet,
          items: [{ ...body.sheet.items[0], cap: 5 }, ...body.sheet.items.slice(1)],
        },
      },
      {
        ...body,
        sheet: {
          ...body.sheet,
          items: [{ ...body.sheet.items[0], hint: "h" }, ...body.sheet.items.slice(1)],
        },
      },
      { ...body, ballots: 1 },
      { ...body, phase: "revealed", revealed: [] },
    ];
    for (const v of variants) expect(signingInput(VOTE_ROOM_EVENTS.state, v)).not.toBe(base);
  });

  it("signs under its own domain, unlike any scale state", () => {
    const input = JSON.parse(signingInput(VOTE_ROOM_EVENTS.state, body)) as unknown[];
    expect(input[0]).toBe("agile-toolkit:vote-room:v2");
    expect(input[2]).toBe(2);
    expect(input[9]).toBe("allocation");
    const scale = JSON.parse(
      signingInput(VOTE_ROOM_EVENTS.state, stateBody(HOST, KEYS as never))
    ) as unknown[];
    expect(scale[0]).toBe("agile-toolkit:vote-room:v1");
  });
});

describe("statistics", () => {
  it("allocationMean is total over people", () => {
    expect(allocationMean(175, 5)).toBe(35);
    expect(allocationMean(0, 0)).toBeNull();
  });

  it("bandAt finds the quantile person's band, and middleHalf the middle half", () => {
    // 5 people: bands 0,1,2,3,4 one each → the median is band 2, quarters 1 and 3.
    expect(bandAt([1, 1, 1, 1, 1], 0.5)).toBe(2);
    expect(bandAt([1, 1, 1, 1, 1], 0.25)).toBe(1);
    expect(bandAt([1, 1, 1, 1, 1], 0.75)).toBe(3);
    expect(bandAt([0, 0, 0, 0, 0], 0.5)).toBeNull();
    expect(bandAt([5, 0, 0, 0, 0], 1)).toBe(0);
    const e = allocationBandEdges(100);
    expect(middleHalf([1, 1, 1, 1, 1], e, 100)).toEqual({ low: [1, 10], high: [26, 50] });
    expect(middleHalfText([1, 1, 1, 1, 1], e, 100, "$")).toBe("$1–$10 to $26–$50");
    expect(middleHalfText([0, 0, 5, 0, 0], e, 100, "$")).toBe("$11–$25");
    expect(middleHalf([0, 0, 0, 0, 0], e, 100)).toBeNull();
  });

  it("cappedTotal splits a total into kept and over", () => {
    expect(cappedTotal(70, 60)).toEqual({ kept: 60, over: 10 });
    expect(cappedTotal(40, 60)).toEqual({ kept: 40, over: 0 });
    expect(cappedTotal(40)).toEqual({ kept: 40, over: 0 });
  });

  it("allocationAmount puts symbols before and words after", () => {
    expect(allocationAmount(40, "$")).toBe("$40");
    expect(allocationAmount(36.25, "$")).toBe("$36.3");
    expect(allocationAmount(9_999, "$")).toBe("$9,999");
    expect(allocationAmount(40, "pts")).toBe("40 pts");
    expect(allocationAmount(40, "")).toBe("40");
  });

  it("allocationRoundMarkdown has one row per item and says when the spread is withheld", () => {
    const meta = {
      tool: "hundred-dollar-test" as const,
      roundId: ROUND,
      closedAt: "2026-10-26T10:00:00.000Z",
      minN: 3,
      source: "live" as const,
    };
    const five = toAllocationResult(
      ALLOCATION_SHEET,
      revealAllocation(tallyOf(ALLOCATION_SHEET, FIVE), 3)!,
      {
        ...meta,
        ballots: 5,
      }
    )!;
    const md = allocationRoundMarkdown(five);
    expect(md).toContain("# Where would you put $100?");
    expect(md).toContain(
      "5 people split anonymously in a live round, 2026-10-26, with $100 each to give out in full."
    );
    expect(md).toContain("| Search | $175 | $35 | 4 | $1–$10 to $26–$50 |");
    const three = toAllocationResult(
      ALLOCATION_SHEET,
      revealAllocation(tallyOf(ALLOCATION_SHEET, FIVE.slice(0, 3)), 3)!,
      { ...meta, ballots: 3 }
    )!;
    expect(allocationRoundMarkdown(three)).toContain("The spread shows from 5 answers.");
    const buy = toAllocationResult(
      { ...BUY_SHEET, title: "Pipes | and\nlines" },
      [
        { total: 70, backers: null, bands: null },
        { total: 10, backers: null, bands: null },
        { total: 10, backers: null, bands: null },
      ],
      { ...meta, tool: "buy-a-feature", ballots: 3, source: "facilitator" }
    )!;
    const bmd = allocationRoundMarkdown(buy);
    expect(bmd).toContain("# Pipes \\| and lines");
    expect(bmd).toContain("| Search | $70 ($10 over its cap) |");
  });
});
