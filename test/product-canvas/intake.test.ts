// @vitest-environment node
/**
 * The idea inbox (P2.3b): an idea's intake read as the page reads it, a
 * new idea, "Asked again" (demand and the requester cap), triage (a decline
 * needs its note), merges (to the root of a chain, never into itself or
 * into an idea merged into it), the inbox's order and counts, the
 * look-alikes found through the Audience Wall's duplicate finder, an
 * idea's gaps, and the CRUD guard's intake rules.
 */

import { describe, expect, it } from "vitest";
import {
  DEMAND_MAX,
  REQUESTERS_MAX,
  likelyDuplicates,
  possibleDuplicates,
  readIntake,
} from "@/lib/product-canvas/fields";
import {
  inboxCounts,
  inboxView,
  mergeIdeas,
  readInboxFilter,
  rootOf,
  unmergeIdea,
} from "@/lib/product-canvas/intake";
import {
  canvasGaps,
  newIdea,
  productCanvasWriteProblems,
  readCanvas,
  withAskedAgain,
  withIdeaStatus,
} from "@/lib/product-canvas/model";
import { fitsEntity } from "@/lib/product-canvas/bytes";
import type {
  ProductCanvas,
  ProductCanvasItem,
  ProductIdeaIntake,
} from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { ENTITY_ROW_MAX_BYTES } from "@/lib/stores/workspace-types";

const NOW = "2026-11-23T10:00:00.000Z";
const LATER = "2026-11-23T11:00:00.000Z";

const item = (id: string, text: string, over: Partial<ProductCanvasItem> = {}) => ({
  id,
  text,
  ...over,
});

function idea(
  id: string,
  title: string,
  intake: Partial<ProductIdeaIntake> = {},
  over: Partial<ProductCanvas> = {}
): ProductCanvas {
  return {
    id,
    format: "idea",
    title,
    sections: {},
    intake: { requesters: [], source: "customer", demand: 1, status: "new", ...intake },
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const ok = <T extends { ok: boolean }>(w: T) => {
  if (!w.ok) throw new Error(`refused: ${JSON.stringify(w)}`);
  return w as Extract<T, { ok: true }>;
};

describe("readIntake", () => {
  it("gives every idea an intake, and a row with none reads as new, asked for once", () => {
    expect(readIntake(undefined)).toEqual({
      requesters: [],
      source: "other",
      demand: 1,
      status: "new",
    });
    expect(readCanvas({ ...idea("pcanvas_1", "Tips"), intake: undefined })?.intake).toEqual({
      requesters: [],
      source: "other",
      demand: 1,
      status: "new",
    });
  });

  it("clamps the demand, and keeps known sources and statuses only", () => {
    expect(readIntake({ demand: 0 }).demand).toBe(1);
    expect(readIntake({ demand: 2.7 }).demand).toBe(2);
    expect(readIntake({ demand: 1e9 }).demand).toBe(DEMAND_MAX);
    expect(readIntake({ demand: "4" }).demand).toBe(1);
    expect(readIntake({ source: "press", status: "won" })).toMatchObject({
      source: "other",
      status: "new",
    });
  });

  it("names the idea it went into only while merged, and never itself", () => {
    expect(readIntake({ status: "merged", mergedInto: "pcanvas_2" }, "pcanvas_1")).toMatchObject({
      status: "merged",
      mergedInto: "pcanvas_2",
    });
    // Merged into nothing, or into itself: it reads as new.
    expect(readIntake({ status: "merged" }, "pcanvas_1").status).toBe("new");
    expect(readIntake({ status: "merged", mergedInto: "pcanvas_1" }, "pcanvas_1").status).toBe(
      "new"
    );
    expect(readIntake({ status: "accepted", mergedInto: "pcanvas_2" })).not.toHaveProperty(
      "mergedInto"
    );
  });

  it("keeps each requester once (case aside), drops blanks, and caps the list", () => {
    const many = Array.from({ length: REQUESTERS_MAX + 5 }, (_, i) => `Role ${i}`);
    expect(readIntake({ requesters: ["Support", " support ", "", 7, "Sales"] }).requesters).toEqual(
      ["Support", "Sales"]
    );
    expect(readIntake({ requesters: many }).requesters).toHaveLength(REQUESTERS_MAX);
  });
});

describe("a new idea", () => {
  it("is asked for once, new, from where it came, with who asked and its problem", () => {
    const w = ok(
      newIdea({
        id: "pcanvas_1",
        now: NOW,
        title: "  Split a bill  ",
        requester: "Support inbox",
        source: "customer",
        problem: "Two friends want to pay half each",
      })
    );
    expect(w.canvas).toMatchObject({
      id: "pcanvas_1",
      format: "idea",
      title: "Split a bill",
      intake: { requesters: ["Support inbox"], source: "customer", demand: 1, status: "new" },
      createdAt: NOW,
    });
    expect(w.canvas.sections.problem?.[0].text).toBe("Two friends want to pay half each");
    expect(readCanvas(w.canvas)).toEqual(w.canvas);
  });

  it("comes from somewhere else unless told, and needs its words", () => {
    expect(ok(newIdea({ id: "x", now: NOW, title: "Tips" })).canvas.intake).toEqual({
      requesters: [],
      source: "other",
      demand: 1,
      status: "new",
    });
    expect(newIdea({ id: "x", now: NOW, title: "   " })).toMatchObject({
      ok: false,
      reason: "blank",
    });
    expect(newIdea({ id: "x", now: NOW, title: "x".repeat(201) })).toMatchObject({
      ok: false,
      reason: "too_long",
    });
    expect(newIdea({ id: "x", now: NOW, title: "Tips", requester: "r".repeat(201) })).toMatchObject(
      { ok: false, reason: "too_long" }
    );
  });
});

describe("asked again", () => {
  it("adds one to the demand and the requester once, stamped", () => {
    const a = ok(
      withAskedAgain(idea("pcanvas_1", "Tips", { requesters: ["Support"] }), "Sales", LATER)
    );
    expect(a.canvas.intake).toMatchObject({ demand: 2, requesters: ["Support", "Sales"] });
    expect(a.canvas.updatedAt).toBe(LATER);
    const b = ok(withAskedAgain(a.canvas, " sales ", LATER));
    expect(b.canvas.intake).toMatchObject({ demand: 3, requesters: ["Support", "Sales"] });
    const c = ok(withAskedAgain(b.canvas, undefined, LATER));
    expect(c.canvas.intake?.demand).toBe(4);
  });

  it("past the requester cap only the demand grows, up to its own cap", () => {
    const full = Array.from({ length: REQUESTERS_MAX }, (_, i) => `Role ${i}`);
    const a = ok(
      withAskedAgain(idea("pcanvas_1", "Tips", { requesters: full }), "One more", LATER)
    );
    expect(a.canvas.intake?.requesters).toEqual(full);
    expect(a.canvas.intake?.demand).toBe(2);
    const top = ok(withAskedAgain(idea("pcanvas_1", "Tips", { demand: DEMAND_MAX }), "x", LATER));
    expect(top.canvas.intake?.demand).toBe(DEMAND_MAX);
  });

  it("is refused for a merged idea, and for a canvas that isn't an idea", () => {
    expect(
      withAskedAgain(
        idea("pcanvas_1", "Tips", { status: "merged", mergedInto: "pcanvas_2" }),
        "x",
        LATER
      )
    ).toMatchObject({ ok: false, reason: "merged" });
    expect(
      withAskedAgain({ ...idea("pcanvas_1", "Tips"), format: "pr-faq" }, "x", LATER)
    ).toMatchObject({ ok: false, reason: "wrong_format" });
  });
});

describe("triage", () => {
  it("needs a note to decline, and keeps the note unless told otherwise", () => {
    const i = idea("pcanvas_1", "Tips");
    expect(withIdeaStatus(i, "declined", undefined, LATER)).toMatchObject({
      ok: false,
      reason: "needs_note",
    });
    expect(withIdeaStatus(i, "declined", "   ", LATER)).toMatchObject({ reason: "needs_note" });
    const d = ok(withIdeaStatus(i, "declined", "Not for stalls", LATER));
    expect(d.canvas.intake).toMatchObject({ status: "declined", note: "Not for stalls" });
    const a = ok(withIdeaStatus(d.canvas, "assessing", undefined, LATER));
    expect(a.canvas.intake).toMatchObject({ status: "assessing", note: "Not for stalls" });
    const cleared = ok(withIdeaStatus(a.canvas, "accepted", "", LATER));
    expect(cleared.canvas.intake).not.toHaveProperty("note");
  });

  it("is refused for a merged idea: taking it out of the merge gives its demand back", () => {
    const m = idea("pcanvas_1", "Two cards", { status: "merged", mergedInto: "pcanvas_2" });
    expect(withIdeaStatus(m, "assessing", undefined, LATER)).toMatchObject({
      ok: false,
      reason: "merged",
    });
  });

  it("is refused on a canvas that isn't an idea", () => {
    expect(
      withIdeaStatus(
        { ...idea("pcanvas_1", "Tips"), format: "shape-up" },
        "accepted",
        undefined,
        LATER
      )
    ).toMatchObject({ ok: false, reason: "wrong_format" });
  });
});

describe("merging ideas", () => {
  const split = idea("pcanvas_split", "Split a bill", { demand: 2, requesters: ["Support"] });
  const cards = idea("pcanvas_cards", "Pay with two cards", {
    demand: 3,
    requesters: ["Sales", "support"],
  });

  it("moves the duplicate's demand and requesters to the idea it repeats", () => {
    const m = mergeIdeas(cards, split, [split, cards], LATER);
    if (!m.ok) throw new Error(m.message);
    expect(m.root.intake).toMatchObject({ demand: 5, requesters: ["Support", "Sales"] });
    expect(m.duplicate.intake).toMatchObject({ status: "merged", mergedInto: "pcanvas_split" });
    expect(m.root.updatedAt).toBe(LATER);
    expect(m.duplicate.updatedAt).toBe(LATER);
  });

  it("follows a chain of merges to its root", () => {
    const merged = idea("pcanvas_mid", "Two cards", {
      status: "merged",
      mergedInto: "pcanvas_split",
    });
    const extra = idea("pcanvas_extra", "Pay half each");
    const m = mergeIdeas(extra, merged, [split, merged, extra], LATER);
    if (!m.ok) throw new Error(m.message);
    expect(m.root.id).toBe("pcanvas_split");
    expect(m.duplicate.intake?.mergedInto).toBe("pcanvas_split");
    expect(rootOf("pcanvas_mid", [split, merged])?.id).toBe("pcanvas_split");
  });

  it("refuses a merge into itself, into an idea merged into it, or of an idea already merged", () => {
    expect(mergeIdeas(split, split, [split], LATER)).toMatchObject({
      ok: false,
      reason: "self_merge",
      message: "An idea can't be merged into itself.",
    });
    const child = idea("pcanvas_child", "Halves", {
      status: "merged",
      mergedInto: "pcanvas_split",
    });
    expect(mergeIdeas(split, child, [split, child], LATER)).toMatchObject({
      ok: false,
      reason: "self_merge",
    });
    expect(mergeIdeas(child, cards, [split, child, cards], LATER)).toMatchObject({
      ok: false,
      reason: "merged",
    });
  });

  it("refuses a chain that loops or leads to an idea that is gone", () => {
    const a = idea("pcanvas_a", "A", { status: "merged", mergedInto: "pcanvas_b" });
    const b = idea("pcanvas_b", "B", { status: "merged", mergedInto: "pcanvas_a" });
    expect(rootOf("pcanvas_a", [a, b])).toBeNull();
    expect(mergeIdeas(split, a, [split, a, b], LATER)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    const lost = idea("pcanvas_lost", "Lost", { status: "merged", mergedInto: "pcanvas_gone" });
    expect(rootOf("pcanvas_lost", [lost])).toBeNull();
  });

  it("takes an idea out of its merge, giving its demand back, so merging it again counts it once", () => {
    const root = idea("pcanvas_r", "Split a bill", { demand: 4, requesters: ["Support"] });
    const dup = idea("pcanvas_d", "Two cards", { demand: 2, requesters: ["Sales"] });
    const m1 = ok(mergeIdeas(dup, root, [root, dup], LATER));
    expect(m1.root.intake?.demand).toBe(6);
    const out = ok(
      unmergeIdea(m1.duplicate, "assessing", undefined, [m1.root, m1.duplicate], LATER)
    );
    expect(out.duplicate.intake).toEqual({
      requesters: ["Sales"],
      source: "customer",
      demand: 2,
      status: "assessing",
    });
    expect(out.carriers.map((c) => c.id)).toEqual(["pcanvas_r"]);
    // Its demand comes off; who asked stays (a name may have asked for both).
    expect(out.carriers[0].intake).toMatchObject({ demand: 4, requesters: ["Support", "Sales"] });
    expect(out.carriers[0].updatedAt).toBe(LATER);
    const m2 = ok(
      mergeIdeas(out.duplicate, out.carriers[0], [out.carriers[0], out.duplicate], LATER)
    );
    expect(m2.root.intake?.demand).toBe(6);
    expect(m2.root.intake?.requesters).toEqual(["Support", "Sales"]);
  });

  it("gives the demand back along a chain of merges, and never below one", () => {
    const c = idea("pcanvas_c", "Root", { demand: 1 });
    const b = idea("pcanvas_b", "Mid", { demand: 1 });
    const a = idea("pcanvas_a", "Leaf", { demand: 3 });
    const ab = ok(mergeIdeas(a, b, [a, b, c], LATER)); // b: 4
    const bc = ok(mergeIdeas(ab.root, c, [ab.duplicate, ab.root, c], LATER)); // c: 5
    const all = [ab.duplicate, bc.duplicate, bc.root];
    const out = ok(unmergeIdea(ab.duplicate, "new", undefined, all, LATER));
    expect(out.carriers.map((x) => [x.id, x.intake?.demand])).toEqual([
      ["pcanvas_b", 1],
      ["pcanvas_c", 2],
    ]);
    // The middle one, taken out after, gives back only its own asks.
    const after = [out.duplicate, ...out.carriers];
    const mid = ok(unmergeIdea(out.carriers[0], "new", undefined, after, LATER));
    expect(mid.carriers.map((x) => [x.id, x.intake?.demand])).toEqual([["pcanvas_c", 1]]);
    // A root counted lower than the duplicate (a hand-edited row) stays at one.
    const low = idea("pcanvas_low", "Low", { demand: 1 });
    const gone = idea("pcanvas_x", "X", { demand: 5, status: "merged", mergedInto: "pcanvas_low" });
    const floor = ok(unmergeIdea(gone, "new", undefined, [low, gone], LATER));
    expect(floor.carriers[0].intake?.demand).toBe(1);
  });

  it("takes an idea out of a merge whose idea is gone, and only triages one that isn't merged", () => {
    const lost = idea("pcanvas_lost", "Lost", { status: "merged", mergedInto: "pcanvas_gone" });
    const out = ok(unmergeIdea(lost, "assessing", undefined, [lost], LATER));
    expect(out.carriers).toEqual([]);
    expect(out.duplicate.intake).not.toHaveProperty("mergedInto");
    const loop = [
      idea("pcanvas_a", "A", { status: "merged", mergedInto: "pcanvas_b", demand: 2 }),
      idea("pcanvas_b", "B", { status: "merged", mergedInto: "pcanvas_a", demand: 3 }),
    ];
    expect(ok(unmergeIdea(loop[0], "new", undefined, loop, LATER)).carriers).toHaveLength(1);
    const plain = idea("pcanvas_p", "Plain");
    expect(ok(unmergeIdea(plain, "accepted", undefined, [plain], LATER))).toMatchObject({
      carriers: [],
      duplicate: { intake: { status: "accepted" } },
    });
    expect(unmergeIdea(lost, "declined", undefined, [lost], LATER)).toMatchObject({
      ok: false,
      reason: "needs_note",
    });
    expect(unmergeIdea({ ...plain, format: "pr-faq" }, "new", undefined, [], LATER)).toMatchObject({
      ok: false,
      reason: "wrong_format",
    });
  });

  it("keeps the joined requesters under the cap", () => {
    const many = (k: string) => Array.from({ length: 15 }, (_, i) => `${k} ${i}`);
    const m = mergeIdeas(
      idea("pcanvas_x", "X", { requesters: many("B") }),
      idea("pcanvas_y", "Y", { requesters: many("A") }),
      [],
      LATER
    );
    if (!m.ok) throw new Error(m.message);
    expect(m.root.intake?.requesters).toHaveLength(REQUESTERS_MAX);
  });
});

describe("the inbox", () => {
  const ideas = [
    idea(
      "pcanvas_a",
      "Tips",
      { demand: 4, status: "assessing" },
      { createdAt: "2026-11-01T09:00:00Z" }
    ),
    idea("pcanvas_b", "Split", { demand: 2 }, { createdAt: "2026-11-02T09:00:00Z" }),
    idea("pcanvas_c", "Receipts", { demand: 2 }, { createdAt: "2026-11-05T09:00:00Z" }),
    idea("pcanvas_d", "Two cards", { status: "merged", mergedInto: "pcanvas_b" }),
    idea("pcanvas_e", "Crypto", { status: "declined", note: "No" }),
    { ...idea("pcanvas_f", "Not an idea"), format: "pr-faq" as const },
  ];

  it("shows the open ideas, most asked for first, then the newest", () => {
    expect(inboxView(ideas).map((c) => c.id)).toEqual(["pcanvas_a", "pcanvas_c", "pcanvas_b"]);
    expect(inboxView(ideas, "merged").map((c) => c.id)).toEqual(["pcanvas_d"]);
    expect(inboxView(ideas, "all")).toHaveLength(5);
  });

  it("counts the ideas in each status", () => {
    expect(inboxCounts(ideas)).toEqual({
      new: 2,
      assessing: 1,
      accepted: 0,
      declined: 1,
      merged: 1,
      open: 3,
      all: 5,
    });
  });

  it("reads a stored filter, falling back to the open ideas", () => {
    expect(readInboxFilter("merged")).toBe("merged");
    expect(readInboxFilter("nope")).toBe("open");
    expect(readInboxFilter(undefined)).toBe("open");
  });
});

describe("ideas that look alike", () => {
  const ideas = [
    idea("pcanvas_split", "Split a bill between two cards", { demand: 2 }),
    idea("pcanvas_cards", "Split the bill between two cards", { demand: 1 }),
    idea("pcanvas_tips", "Tips on the payment screen", { demand: 4 }),
    idea("pcanvas_gone", "Split a bill between two cards", { status: "declined", note: "x" }),
  ];

  it("finds the open ideas close to a typed title, most asked for first", () => {
    expect(likelyDuplicates("split a bill between cards", ideas).map((i) => i.id)).toEqual([
      "pcanvas_split",
      "pcanvas_cards",
    ]);
    expect(likelyDuplicates("Tips on the payment screen!", ideas).map((i) => i.id)).toEqual([
      "pcanvas_tips",
    ]);
    expect(likelyDuplicates("Dark mode", ideas)).toEqual([]);
    expect(likelyDuplicates("", ideas)).toEqual([]);
    expect(
      likelyDuplicates("Split a bill between two cards", ideas, { exclude: "pcanvas_split" }).map(
        (i) => i.id
      )
    ).toEqual(["pcanvas_cards"]);
  });

  it("groups the open ideas that look alike under the one asked for most", () => {
    const groups = possibleDuplicates(ideas);
    expect(groups.map((g) => [g.keep.id, g.merge.map((m) => m.id)])).toEqual([
      ["pcanvas_split", ["pcanvas_cards"]],
    ]);
  });

  it("says so in the idea's gaps, with how it'd know it worked", () => {
    const c = idea("pcanvas_cards", "Split the bill between two cards");
    const texts = canvasGaps(c, { ideas }).map((g) => g.text);
    expect(texts).toContain("Say how you'd know it worked before you accept it.");
    expect(texts).toContain(
      "“Split a bill between two cards” looks like the same idea. Merge them, or say how they differ."
    );
    const signal = { ...c, sections: { signal: [item("s1", "Halves on 5% of payments")] } };
    expect(canvasGaps(signal).map((g) => g.text)).not.toContain(
      "Say how you'd know it worked before you accept it."
    );
    // A merged idea isn't asked to merge again.
    const merged = {
      ...c,
      intake: { ...c.intake!, status: "merged" as const, mergedInto: "pcanvas_split" },
    };
    expect(canvasGaps(merged, { ideas }).some((g) => /looks like/.test(g.text))).toBe(false);
  });
});

describe("the CRUD guard on an idea", () => {
  it("passes a sound idea, and refuses an intake anywhere else", () => {
    const i = idea("pcanvas_1", "Tips", { requesters: ["Support"] });
    expect(productCanvasWriteProblems(i, null)).toEqual([]);
    expect(
      productCanvasWriteProblems({ ...i, format: "vision-board" } as ProductCanvas, null)
    ).toContain("A Vision Board has no intake.");
    expect(productCanvasWriteProblems({ ...i, bet: { status: "table" } }, null)).toContain(
      "An Idea inbox has no bet."
    );
  });

  it("names what the page would change in an intake", () => {
    expect(
      productCanvasWriteProblems(idea("pcanvas_1", "Tips", { status: "merged" }), null)
    ).toContain("A merged idea names the idea it was merged into, and never itself.");
    expect(
      productCanvasWriteProblems(
        idea("pcanvas_1", "Tips", { status: "new", mergedInto: "pcanvas_2" }),
        null
      )
    ).toContain("Only a merged idea names the idea it was merged into.");
    expect(
      productCanvasWriteProblems(idea("pcanvas_1", "Tips", { requesters: ["A", "a", ""] }), null)
    ).toContain("Each requester is named once, and none is blank.");
  });
});

describe("an idea at its caps", () => {
  it.each([
    ["界", 3],
    ["😀", 4],
  ] as const)("in %s text (%i bytes a character) stays under the row limit", (ch, bytes) => {
    expect(new TextEncoder().encode(ch).length).toBe(bytes);
    const text = (n: number) => ch.repeat(bytes === 4 ? n / 2 : n);
    const list = (key: string, n: number) =>
      Array.from({ length: n }, (_, i) =>
        item(`${key}${i}`.padEnd(64, "x"), text(200), { evidence: "assumption" as const })
      );
    const c: ProductCanvas = {
      ...idea("pcanvas_xxxxxxxx", text(200), {
        requesters: Array.from({ length: REQUESTERS_MAX }, (_, i) => `${i}${text(199)}`),
        note: text(1000),
        demand: DEMAND_MAX,
        status: "accepted",
      }),
      sections: {
        problem: [item("p", text(200))],
        idea: [item("i", text(200))],
        who: list("w", 8),
        today: list("t", 8),
        gain: list("g", 8),
        signal: list("s", 6),
        "why-us": list("y", 6),
        cost: list("c", 6),
        questions: list("q", 16),
      },
    };
    const read = readCanvas(c)!;
    expect(fitsEntity(read)).toBe(true);
    expect(jsonBytes(read)).toBeLessThan(ENTITY_ROW_MAX_BYTES);
  });
});
