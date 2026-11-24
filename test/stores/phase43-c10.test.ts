/**
 * Product Canvas's three P2.3b formats in the workspace store (chain C10;
 * the base's phase43 tests cover the collection itself).
 *
 * The base's `PRODUCT_CANVAS` fixture is a Shape Up pitch carrying fields
 * of other formats (an intake, a decision, answers and marks on boxes that
 * take none). Now that the catalog holds the Shape Up pitch, the CRUD's
 * write guard (wired at the P2.3a landing) refuses that row. The rows
 * below are this chain's follow-up for `test/stores/phase43-fixtures.ts`:
 * a sound Shape Up pitch in its place, and an idea and a business case
 * beside it, so the fields the old row carried are still covered. Each
 * passes the guard, reads back as written, and rides export and import.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The store registers its sync targets with the engine: capture, don't start one.
vi.mock("@/lib/sync/register", () => ({
  registerEntityCollection: () => {},
  registerBlobStore: () => {},
}));

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { productCanvasWriteProblems, readCanvas } from "@/lib/product-canvas/model";
import type { ProductCanvas } from "@/lib/stores/workspace-types";
import { AT, LATER } from "./phase43-fixtures";

const ws = () => useWorkspaceStore.getState();

/** The follow-up's `PRODUCT_CANVAS`: a Shape Up pitch with every field a pitch keeps. */
const PITCH: ProductCanvas = {
  id: "pcanvas_1",
  format: "shape-up",
  title: "Refunds without a call",
  sections: {
    problem: [{ id: "p1", text: "Shop owners phone us to refund a payment.", owner: "Ana" }],
    "no-gos": [
      {
        id: "n1",
        text: "No partial refunds this cycle",
        sentTo: [{ route: "decision", targetId: "dec_1", at: LATER }],
      },
    ],
    scopes: [
      {
        id: "s1",
        text: "Refund a whole payment",
        niceToHave: true,
        sentTo: [{ route: "backlog-story", targetId: "story_7", at: LATER }],
      },
    ],
  },
  appetiteWeeks: 6,
  bet: { status: "bet", cycle: 4, start: "2026-12-01", weeks: 6, decidedAt: LATER },
  productGoalId: "goal_1",
  sentTo: [{ route: "hypothesis", targetId: "hyp_1", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

/** The follow-up's `PRODUCT_IDEA`: an idea merged into another, with its marks and links. */
const IDEA: ProductCanvas = {
  id: "pcanvas_2",
  format: "idea",
  title: "Refund from the phone",
  sections: {
    problem: [{ id: "i1", text: "Refunds need a phone call." }],
    who: [{ id: "i2", text: "Market stall holders", evidence: "fact" }],
  },
  intake: {
    requesters: ["Shop owners", "Support"],
    source: "customer",
    demand: 40,
    status: "merged",
    mergedInto: "pcanvas_0",
    note: "Asked for since spring.",
  },
  sentTo: [{ route: "opportunity", targetId: "opp_1", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

/** The follow-up's `PRODUCT_CASE`: a business case with its decision. */
const CASE: ProductCanvas = {
  id: "pcanvas_3",
  format: "business-case",
  title: "Card-free shops",
  sections: {
    epic: [{ id: "c1", text: "Every payment on the owner's phone" }],
    expect: [{ id: "c2", text: "Shops stop renting a card machine.\n\nMore card payments." }],
  },
  decision: { verdict: "go", note: "Worth six weeks.", decidedAt: LATER },
  sentTo: [{ route: "decision", targetId: "dec_2", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

beforeAll(async () => {
  await Promise.resolve(useWorkspaceStore.persist.rehydrate());
});

beforeEach(() => {
  ws().resetWorkspace();
});

describe("the fixture rows this chain's follow-up proposes", () => {
  it.each([
    ["a Shape Up pitch", PITCH],
    ["an idea", IDEA],
    ["a business case", CASE],
  ] as const)("%s passes the CRUD's write guard and reads back as written", (_name, row) => {
    expect(productCanvasWriteProblems(row, null)).toEqual([]);
    expect(productCanvasWriteProblems(row, row)).toEqual([]);
    expect(readCanvas(row)).toEqual(row);
  });

  it("ride export and import as they are", () => {
    for (const row of [PITCH, IDEA, CASE]) ws().upsertProductCanvas(row);
    const json = ws().exportJSON();
    ws().resetWorkspace();
    ws().importJSON(json);
    expect(ws().productCanvases).toEqual(expect.arrayContaining([PITCH, IDEA, CASE]));
  });

  it("refuse each other's fields: the reason the base's row needs replacing", () => {
    expect(productCanvasWriteProblems({ ...PITCH, intake: IDEA.intake }, null)).toEqual([
      "A Shape Up pitch has no intake.",
    ]);
    expect(productCanvasWriteProblems({ ...IDEA, decision: CASE.decision }, null)).toEqual([
      "An Idea inbox has no decision.",
    ]);
    expect(productCanvasWriteProblems({ ...CASE, bet: PITCH.bet }, null)).toEqual([
      "A Business case has no bet.",
    ]);
  });
});
