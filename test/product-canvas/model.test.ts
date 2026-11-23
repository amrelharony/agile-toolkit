// @vitest-environment node
/**
 * Product Canvas's model (lib/product-canvas/model): reading a canvas (the
 * kit's clean, then the product rules), every write and its refusals, the
 * byte guard, and what the page works out: the pitch, jargon and feature
 * words, the fit meter, the Lean UX hypothesis, the press release's words
 * and hard questions, each format's gaps, and the CRUD's write guard.
 */

import { describe, expect, it } from "vitest";
import {
  CANVAS_FULL,
  FIT_NOTE,
  ITEM_MAX,
  LINKS_MAX,
  LONG_MAX,
  PRODUCT_CANVAS_ID_PREFIX,
  boxesFilled,
  canvasGaps,
  featureWordsIn,
  fitLine,
  fitMeter,
  gapViewOf,
  gapsOf,
  hardQuestions,
  hypothesisPicks,
  hypothesisSentence,
  itemCount,
  jargonIn,
  linkersOf,
  newCanvas,
  newCanvasId,
  pitchSentence,
  productCanvasWriteProblems,
  readCanvas,
  readCanvases,
  releaseWords,
  validateCanvasTitle,
  validateItem,
  validateLaunchDate,
  withDraftLines,
  withHypothesis,
  withItem,
  withItemPatch,
  withItems,
  withLinksRestored,
  withSectionItems,
  withText,
  withTitle,
  withoutItem,
  wordCount,
} from "@/lib/product-canvas/model";
import { TOO_BIG_TO_SAVE, fitsEntity } from "@/lib/product-canvas/bytes";
import { BUILT_FORMATS, PRODUCT_FORMATS } from "@/lib/product-canvas/formats";
import { removeDraftLines } from "@/lib/sectioned/model";
import {
  ENTITY_ROW_MAX_BYTES,
  type HandoffLink,
  type ProductCanvas,
  type ProductCanvasFormat,
  type ProductCanvasItem,
} from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

const NOW = "2026-11-23T10:00:00.000Z";
const LATER = "2026-11-23T11:00:00.000Z";

const item = (
  id: string,
  text: string,
  over: Partial<ProductCanvasItem> = {}
): ProductCanvasItem => ({
  id,
  text,
  ...over,
});

function canvas(
  format: ProductCanvasFormat,
  sections: Record<string, ProductCanvasItem[]> = {},
  over: Partial<ProductCanvas> = {}
): ProductCanvas {
  return {
    id: "pcanvas_t1",
    format,
    title: "Tapline",
    sections,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const link = (targetId: string): HandoffLink => ({ route: "hypothesis", targetId, at: NOW });

/** A Value Proposition with every box full: 91 lines, more than a canvas holds. */
function fullValueProposition(): ProductCanvas {
  const list = (key: string, n: number) =>
    Array.from({ length: n }, (_, i) => item(`${key}${i}`, `${key} ${i}`));
  return canvas("value-proposition", {
    customer: [item("cust", "Stall holders")],
    jobs: list("j", 10),
    pains: list("p", 10),
    gains: list("g", 10),
    offer: list("o", 10),
    eases: list("e", 10),
    adds: list("a", 10),
    questions: list("q", 20),
  });
}

const ok = <T extends { ok: boolean }>(w: T) => {
  if (!w.ok) throw new Error(`refused: ${JSON.stringify(w)}`);
  return w as Extract<T, { ok: true }>;
};

describe("readCanvas", () => {
  it("reads a sound canvas as it is", () => {
    const c = canvas("vision-board", { who: [item("a", "Stall holders", { evidence: "fact" })] });
    expect(readCanvas(c)).toEqual(c);
  });

  it("refuses rows with no id, and formats this build doesn't offer", () => {
    expect(readCanvas(null)).toBeNull();
    expect(readCanvas({ ...canvas("vision-board"), id: "" })).toBeNull();
    expect(readCanvas({ ...canvas("vision-board"), format: "idea" })).toBeNull();
    expect(readCanvas({ ...canvas("vision-board"), format: "nope" })).toBeNull();
  });

  it("drops boxes the format lacks, cuts text to its box's cap and falls back to the format's name", () => {
    const raw = {
      ...canvas("vision-board"),
      title: "   ",
      sections: {
        nope: [item("x", "gone")],
        who: [item("a", "y".repeat(ITEM_MAX + 50))],
        vision: [item("v", "v".repeat(ITEM_MAX + 5))],
      },
    };
    const c = readCanvas(raw)!;
    expect(c.title).toBe("Vision Board");
    expect(Object.keys(c.sections).sort()).toEqual(["vision", "who"]);
    expect(c.sections.who[0].text).toHaveLength(ITEM_MAX);
    expect(c.sections.vision[0].text).toHaveLength(ITEM_MAX);
    const lean = readCanvas({
      ...canvas("lean-ux"),
      sections: { problem: [item("p", "p".repeat(LONG_MAX + 5))] },
    })!;
    expect(lean.sections.problem[0].text).toHaveLength(LONG_MAX);
  });

  it("keeps a mark, an answer, links and a hard question only where the box takes them", () => {
    const raw = canvas("pr-faq", {
      headline: [item("h", "Launch", { evidence: "fact", detail: "no" } as ProductCanvasItem)],
      "customer-faq": [item("q1", "Does it work offline?", { detail: "Yes.", evidence: "fact" })],
      "internal-faq": [
        item("q2", "Cost?", { promptId: "hq-cost", niceToHave: true }),
        item("q3", "Other?", { promptId: "hq-nope" }),
      ],
    });
    const c = readCanvas(raw)!;
    expect(c.sections.headline[0]).toEqual({ id: "h", text: "Launch" });
    expect(c.sections["customer-faq"][0]).toEqual({
      id: "q1",
      text: "Does it work offline?",
      detail: "Yes.",
    });
    expect(c.sections["internal-faq"][0]).toEqual({ id: "q2", text: "Cost?", promptId: "hq-cost" });
    expect(c.sections["internal-faq"][1]).toEqual({ id: "q3", text: "Other?" });
  });

  it("keeps only links to lines that are there, in the boxes a line may link to", () => {
    const c = readCanvas(
      canvas("value-proposition", {
        pains: [item("p1", "No signal")],
        gains: [item("g1", "Paid sooner")],
        eases: [item("e1", "Works offline", { links: ["p1", "g1", "gone", "p1"] })],
        adds: [item("a1", "Next-day payout", { links: ["g1"] })],
        offer: [item("o1", "Tap to pay", { links: ["p1"] })],
      })
    )!;
    expect(c.sections.eases[0].links).toEqual(["p1"]);
    expect(c.sections.adds[0].links).toEqual(["g1"]);
    expect(c.sections.offer[0].links).toBeUndefined();
  });

  it("drops a mark that isn't fact or assumption, and a link list over the cap", () => {
    const pains = Array.from({ length: 10 }, (_, i) => item(`p${i}`, `Pain ${i}`));
    const c = readCanvas(
      canvas("value-proposition", {
        pains: [...pains.slice(0, 9), item("p9", "Pain 9", { evidence: "maybe" as never })],
        eases: [item("e1", "All of them", { links: [...pains.map((p) => p.id), "p0"] })],
      })
    )!;
    expect(c.sections.pains[9].evidence).toBeUndefined();
    expect(c.sections.eases[0].links).toHaveLength(10);
  });

  it("makes line ids unique across the canvas, the first one kept", () => {
    const c = readCanvas(
      canvas("pr-faq", {
        "customer-faq": [item("dup", "First"), item("c1", "Other")],
        "internal-faq": [item("dup", "Second"), item("i1", "More")],
      })
    )!;
    const ids = Object.values(c.sections)
      .flat()
      .map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(c.sections["customer-faq"][0].text).toBe("First");
    expect(c.sections["internal-faq"].map((i) => i.text)).toEqual(["More"]);
  });

  it("caps a canvas at 60 lines, in the format's order", () => {
    const c = readCanvas(fullValueProposition())!;
    expect(itemCount(c)).toBe(60);
    expect(c.sections.adds).toHaveLength(9);
    expect(c.sections.questions).toEqual([]);
  });

  it("keeps valid hand-off links on the canvas and its lines", () => {
    const c = readCanvas({
      ...canvas("vision-board", {
        who: [item("a", "Stall holders", { sentTo: [link("h1"), { route: "nope" } as never] })],
      }),
      sentTo: [link("h2"), { route: "hypothesis" } as never],
      productGoalId: "goal_1",
    })!;
    expect(c.sections.who[0].sentTo).toEqual([link("h1")]);
    expect(c.sentTo).toEqual([link("h2")]);
    expect(c.productGoalId).toBe("goal_1");
  });

  it("drops the fields a format doesn't use", () => {
    const c = readCanvas({
      ...canvas("vision-board"),
      appetiteWeeks: 2,
      intake: { requesters: [], source: "team", demand: 1, status: "new" },
      bet: { status: "bet" },
    })!;
    expect(c).not.toHaveProperty("appetiteWeeks");
    expect(c).not.toHaveProperty("intake");
    expect(c).not.toHaveProperty("bet");
  });

  it("lists readable canvases newest change first", () => {
    const rows = [
      canvas("vision-board", {}, { id: "a", updatedAt: NOW }),
      { id: "bad" },
      canvas("pr-faq", {}, { id: "b", updatedAt: LATER }),
    ];
    expect(readCanvases(rows).map((c) => c.id)).toEqual(["b", "a"]);
    expect(readCanvases(undefined)).toEqual([]);
  });
});

describe("new canvases and the id prefix", () => {
  it("mints ids with the CRUD's prefix", () => {
    expect(newCanvasId().startsWith(PRODUCT_CANVAS_ID_PREFIX)).toBe(true);
    expect(PRODUCT_CANVAS_ID_PREFIX).toBe("pcanvas_");
  });

  it("starts empty, named, stamped and tied to the goal it was made for", () => {
    const c = newCanvas({
      id: "pcanvas_x",
      format: "lean-ux",
      title: "  Queue  ",
      now: NOW,
      productGoalId: "g1",
    });
    expect(c).toEqual({
      id: "pcanvas_x",
      format: "lean-ux",
      title: "Queue",
      sections: {},
      createdAt: NOW,
      updatedAt: NOW,
      productGoalId: "g1",
    });
    expect(() => newCanvas({ id: "x", format: "idea", title: "x", now: NOW })).toThrow();
  });
});

describe("writes", () => {
  it("adds lines to a list box, stamped, all or none", () => {
    const c = canvas("vision-board", { who: [item("a", "Stall holders")] });
    let n = 0;
    const w = ok(
      withItems(
        c,
        "who",
        [{ text: " Cleaners " }, { text: "Hairdressers" }],
        LATER,
        () => `n${++n}`
      )
    );
    expect(w.canvas.sections.who.map((i) => i.text)).toEqual([
      "Stall holders",
      "Cleaners",
      "Hairdressers",
    ]);
    expect(w.ids).toEqual(["n1", "n2"]);
    expect(w.canvas.updatedAt).toBe(LATER);
    expect(c.sections.who).toHaveLength(1);
  });

  it("refuses an unknown box, a one-line box, blank or long text, and a full box", () => {
    const c = canvas("vision-board", {
      who: Array.from({ length: 8 }, (_, i) => item(`w${i}`, `G${i}`)),
    });
    expect(withItem(c, "nope", { text: "x" }, NOW)).toMatchObject({
      ok: false,
      reason: "unknown_section",
    });
    expect(withItem(c, "vision", { text: "x" }, NOW)).toMatchObject({
      ok: false,
      reason: "not_a_list",
    });
    expect(withItem(c, "needs", { text: "  " }, NOW)).toMatchObject({ ok: false, reason: "blank" });
    expect(withItem(c, "needs", { text: "x".repeat(ITEM_MAX + 1) }, NOW)).toMatchObject({
      ok: false,
      reason: "too_long",
    });
    const full = withItem(c, "who", { text: "One more" }, NOW);
    expect(full).toMatchObject({ ok: false, reason: "section_full" });
    expect(
      withItems(
        c,
        "needs",
        Array.from({ length: 11 }, () => ({ text: "x" })),
        NOW
      )
    ).toMatchObject({
      ok: false,
      reason: "section_full",
    });
  });

  it("refuses a 61st line on the canvas, wherever it would go", () => {
    const c = readCanvas(fullValueProposition())!;
    expect(withItem(c, "questions", { text: "One more" }, NOW)).toEqual({
      ok: false,
      reason: "canvas_full",
      message: CANVAS_FULL,
    });
    expect(withSectionItems(c, "questions", [item("n1", "One more")], NOW)).toMatchObject({
      ok: false,
      reason: "canvas_full",
    });
    const room = { ...c, sections: { ...c.sections, customer: [] } };
    expect(withText(room, "customer", "Back", NOW).ok).toBe(true);
    expect(withText(c, "customer", "Edited in place", NOW).ok).toBe(true);
    expect(CANVAS_FULL).toMatch(/60 lines/);
  });

  it("replaces a box's lines as the card hands them over, and lets a delete through", () => {
    const c = canvas("vision-board", { who: [item("a", "A"), item("b", "B")] });
    const w = ok(withSectionItems(c, "who", [item("b", "B")], NOW));
    expect(w.canvas.sections.who).toEqual([item("b", "B")]);
    expect(withSectionItems(c, "nope", [], NOW)).toMatchObject({
      ok: false,
      reason: "unknown_section",
    });
    expect(withSectionItems(c, "vision", [item("v1", "x"), item("v2", "y")], NOW)).toMatchObject({
      ok: false,
      reason: "section_full",
    });
  });

  it("removes a line, and drops links to it", () => {
    const c = canvas("value-proposition", {
      pains: [item("p1", "No signal")],
      eases: [item("e1", "Offline", { links: ["p1"] })],
    });
    const w = ok(withoutItem(c, "p1", NOW));
    expect(w.canvas.sections.pains).toEqual([]);
    expect(w.canvas.sections.eases[0].links).toBeUndefined();
    expect(withoutItem(c, "nope", NOW)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("links a deleted line's linkers again once its Undo brings it back, each link in its place", () => {
    const c = canvas("value-proposition", {
      pains: [item("p1", "No signal"), item("p2", "Slow queue")],
      eases: [item("e1", "Offline", { links: ["p1", "p2"] }), item("e2", "Fast")],
    });
    const linkers = linkersOf(c, "p1");
    expect(linkers).toEqual([{ itemId: "e1", links: ["p1", "p2"] }]);
    expect(linkersOf(c, "p2")).toEqual([{ itemId: "e1", links: ["p1", "p2"] }]);
    expect(linkersOf(c, "e1")).toEqual([]);

    const gone = ok(withoutItem(c, "p1", NOW)).canvas;
    expect(gone.sections.eases[0].links).toEqual(["p2"]);
    // Not back yet: nothing to link to, and the canvas is left as it is.
    expect(ok(withLinksRestored(gone, "p1", linkers, LATER)).canvas).toBe(gone);

    const back = ok(
      withSectionItems(gone, "pains", [item("p1", "No signal"), ...gone.sections.pains], NOW)
    ).canvas;
    expect(back.sections.eases[0].links).toEqual(["p2"]);
    const relinked = ok(withLinksRestored(back, "p1", linkers, LATER)).canvas;
    expect(relinked.sections.eases[0].links).toEqual(["p1", "p2"]);
    expect(relinked.updatedAt).toBe(LATER);
    expect(fitMeter(relinked).pains).toEqual({ eased: 2, total: 2 });
    // Already linked: nothing changes.
    expect(ok(withLinksRestored(relinked, "p1", linkers, LATER)).canvas).toBe(relinked);
  });

  it("keeps links added since the delete, and skips a linker that is gone or full", () => {
    const lean = canvas("lean-ux", {
      outcomes: [item("o1", "More sales"), item("o2", "Fewer refunds")],
      users: [item("u1", "Stall holders")],
      benefits: [item("b1", "keep selling")],
      solutions: [item("s1", "an offline queue")],
      hypotheses: [item("h1", "H1", { links: ["o2", "u1", "b1"] })],
      "learn-first": [item("l1", "Ask ten stalls", { links: ["h1"] })],
    });
    const linkers = [
      { itemId: "h1", links: ["o1", "u1", "b1"] },
      { itemId: "gone", links: ["o1"] },
    ];
    const w = ok(withLinksRestored(lean, "o1", linkers, LATER)).canvas;
    // o1 back where it was; o2, linked since, stays after the old links.
    expect(w.sections.hypotheses[0].links).toEqual(["o1", "u1", "b1", "o2"]);

    const many = (key: string, n: number) =>
      Array.from({ length: n }, (_, i) => item(`${key}${i}`, `${key} ${i}`));
    const full = canvas("lean-ux", {
      outcomes: many("o", 4),
      users: many("u", 4),
      benefits: many("b", 3),
      hypotheses: [
        item("h1", "H1", {
          links: [...many("o", 3), ...many("u", 4), ...many("b", 3)].map((i) => i.id),
        }),
      ],
    });
    expect(full.sections.hypotheses[0].links).toHaveLength(LINKS_MAX);
    expect(ok(withLinksRestored(full, "o3", [{ itemId: "h1", links: ["o3"] }], LATER)).canvas).toBe(
      full
    );
  });

  it("patches a line's words, mark, answer and links, refusing what its box doesn't take", () => {
    const c = canvas("value-proposition", {
      pains: [item("p1", "No signal", { evidence: "fact" })],
      eases: [item("e1", "Offline")],
    });
    expect(
      ok(withItemPatch(c, "p1", { text: "No signal at all" }, NOW)).canvas.sections.pains[0].text
    ).toBe("No signal at all");
    expect(ok(withItemPatch(c, "p1", { evidence: null }, NOW)).canvas.sections.pains[0]).toEqual(
      item("p1", "No signal")
    );
    expect(
      ok(withItemPatch(c, "e1", { links: ["p1"] }, NOW)).canvas.sections.eases[0].links
    ).toEqual(["p1"]);
    expect(withItemPatch(c, "e1", { links: ["e1"] }, NOW)).toMatchObject({
      ok: false,
      reason: "bad_field",
    });
    expect(withItemPatch(c, "e1", { evidence: "fact" }, NOW)).toMatchObject({
      ok: false,
      reason: "bad_field",
    });
    expect(withItemPatch(c, "p1", { detail: "x" }, NOW)).toMatchObject({
      ok: false,
      reason: "bad_field",
    });
    expect(withItemPatch(c, "p1", { links: [] }, NOW)).toMatchObject({
      ok: false,
      reason: "bad_field",
    });
    expect(withItemPatch(c, "p1", { niceToHave: true }, NOW)).toMatchObject({
      ok: false,
      reason: "bad_field",
    });
    expect(withItemPatch(c, "p1", { text: " " }, NOW)).toMatchObject({
      ok: false,
      reason: "blank",
    });
    expect(withItemPatch(c, "nope", { text: "x" }, NOW)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("sets and clears a one-line or paragraph box, keeping its line's id", () => {
    const c = canvas("lean-ux");
    const set = ok(withText(c, "problem", "Sales lost\r\nwith no signal", NOW, () => "p1"));
    expect(set.canvas.sections.problem).toEqual([item("p1", "Sales lost\nwith no signal")]);
    const again = ok(withText(set.canvas, "problem", "Sales lost", LATER, () => "nope"));
    expect(again.canvas.sections.problem).toEqual([item("p1", "Sales lost")]);
    expect(ok(withText(again.canvas, "problem", null, LATER)).canvas.sections.problem).toEqual([]);
    expect(withText(c, "outcomes", "x", NOW)).toMatchObject({ ok: false, reason: "not_an_answer" });
    expect(withText(c, "problem", "x".repeat(LONG_MAX + 1), NOW)).toMatchObject({
      ok: false,
      reason: "too_long",
    });
  });

  it("renames, refusing a blank name", () => {
    const c = canvas("pr-faq");
    expect(ok(withTitle(c, "  Launch news ", NOW)).canvas.title).toBe("Launch news");
    expect(withTitle(c, " ", NOW)).toMatchObject({ ok: false, reason: "blank" });
  });

  it("adds accepted draft lines as guesses with their answers, and Undo takes out exactly those", () => {
    const c = canvas("pr-faq", { "customer-faq": [item("q0", "Old question")] });
    let n = 0;
    const r = withDraftLines(
      c,
      [
        { sectionId: "customer-faq", text: "Does it work offline?", detail: "Yes, it waits." },
        { sectionId: "headline", text: "Tapline launches" },
        { sectionId: "nope", text: "Lost" },
      ],
      NOW,
      () => `d${++n}`
    );
    const w = ok(r.write);
    expect(r.added).toEqual([
      { sectionId: "customer-faq", itemId: "d1" },
      { sectionId: "headline", itemId: "d2" },
    ]);
    expect(r.skipped).toBe(1);
    expect(w.canvas.sections["customer-faq"][1]).toEqual(
      item("d1", "Does it work offline?", { detail: "Yes, it waits." })
    );
    const undone = removeDraftLines(w.canvas.sections, r.added);
    expect(undone["customer-faq"]).toEqual([item("q0", "Old question")]);
    expect(undone.headline).toEqual([]);
    const vb = withDraftLines(
      canvas("vision-board"),
      [{ sectionId: "who", text: "Cleaners" }],
      NOW,
      () => "w1"
    );
    expect(ok(vb.write).canvas.sections.who).toEqual([
      item("w1", "Cleaners", { evidence: "assumption" }),
    ]);
  });

  it("never lets an accepted draft overwrite a box that holds text", () => {
    const c = canvas("vision-board", { vision: [item("v", "Ours")] });
    const r = withDraftLines(c, [{ sectionId: "vision", text: "Theirs" }], NOW);
    expect(r.added).toEqual([]);
    expect(r.skipped).toBe(1);
    expect(ok(r.write).canvas.sections.vision).toEqual([item("v", "Ours")]);
  });
});

describe("the byte guard", () => {
  /** Every box of a format at its caps, in text whose characters cost `bytes` each. */
  function atCaps(format: ProductCanvasFormat, char: string): ProductCanvas {
    const f = PRODUCT_FORMATS[format]!;
    const sections: Record<string, ProductCanvasItem[]> = {};
    let total = 0;
    for (const d of f.sections) {
      const max = d.kind === "list" ? d.max : 1;
      const cap = d.kind === "long" ? LONG_MAX : ITEM_MAX;
      const text = char.repeat(Math.floor(cap / char.length));
      const items: ProductCanvasItem[] = [];
      for (let i = 0; i < max && total < 60; i++, total++) {
        items.push(
          item(`${d.id}-${i}`.slice(0, 64), text, {
            ...(d.qa ? { detail: char.repeat(Math.floor(LONG_MAX / char.length)) } : {}),
            ...(d.evidence ? { evidence: "assumption" as const } : {}),
            sentTo: [link(`h${"x".repeat(30)}`)],
          })
        );
      }
      sections[d.id] = items;
    }
    return readCanvas(canvas(format, sections, { id: `pcanvas_${"x".repeat(8)}` }))!;
  }

  it.each(
    BUILT_FORMATS.flatMap(
      (f) =>
        [
          [f, "界", 3],
          [f, "😀", 4],
        ] as const
    )
  )(
    "a %s at every cap in %s text (%i bytes a character) stays under the row limit",
    (format, char, bytes) => {
      expect(new TextEncoder().encode(char).length).toBe(bytes);
      const c = atCaps(format, char);
      expect(fitsEntity(c)).toBe(true);
      expect(jsonBytes(c)).toBeLessThan(ENTITY_ROW_MAX_BYTES);
    }
  );

  it("refuses a write past the row limit with the CRUD's own sentence", () => {
    const huge = canvas("vision-board", {
      who: [item("a", "Stall holders", { sentTo: [link("t".repeat(ENTITY_ROW_MAX_BYTES))] })],
    });
    const w = withItem(huge, "needs", { text: "One more" }, NOW);
    expect(w).toEqual({ ok: false, reason: "too_big", message: TOO_BIG_TO_SAVE });
    expect(TOO_BIG_TO_SAVE).toBe(
      "This product canvas is too big to save. Shorten or remove some lines. Nothing was saved."
    );
  });
});

describe("the Vision Board", () => {
  const parts = {
    name: "Tapline",
    who: "Stall holders at weekend markets",
    need: "Sell to a buyer with no cash.",
    benefit: "Take card payments on their own phone",
    today: "A rented card machine",
    difference: "It needs no extra device",
  };

  it("writes the pitch in our own shape, never the For/who/Unlike template", () => {
    expect(pitchSentence(parts)).toBe(
      "Tapline helps stall holders at weekend markets take card payments on their own phone when they sell to a buyer with no cash. Today they get by with a rented card machine; Tapline is different because it needs no extra device."
    );
    expect(pitchSentence(parts)).not.toMatch(/\bUnlike\b|^For /);
  });

  it("drops the clauses of empty boxes, and says nothing with none filled", () => {
    expect(pitchSentence({ ...parts, today: "", difference: "", need: "" })).toBe(
      "Tapline helps stall holders at weekend markets take card payments on their own phone."
    );
    expect(pitchSentence({ ...parts, name: "", who: "", benefit: "", need: "", today: "" })).toBe(
      "It is different because it needs no extra device."
    );
    expect(
      pitchSentence({ name: "", who: "", need: "", benefit: "", today: "", difference: "" })
    ).toBe("");
    expect(pitchSentence({ ...parts, who: "SMEs in towns" })).toContain("helps SMEs in towns");
  });

  it("finds jargon and feature words as whole words", () => {
    expect(jargonIn("A seamless, best in class and frictionless way")).toEqual([
      "seamless",
      "best-in-class",
      "frictionless",
    ]);
    expect(jargonIn("Seamlessness is not a word we list")).toEqual([]);
    expect(featureWordsIn("An app with a dashboard")).toEqual(["app", "dashboard"]);
    expect(featureWordsIn("Happy shop owners")).toEqual([]);
  });

  it("counts boxes filled", () => {
    const c = canvas("vision-board", { vision: [item("v", "x")], who: [item("w", " ")] });
    expect(boxesFilled(c)).toEqual({ filled: 1, total: 12 });
  });
});

describe("the Value Proposition's fit meter", () => {
  const c = canvas("value-proposition", {
    pains: [
      item("p1", "No signal", { evidence: "fact" }),
      item("p2", "No cash", { sentTo: [link("h-ok")] }),
      item("p3", "Rent"),
    ],
    gains: [item("g1", "Paid sooner"), item("g2", "Fewer trips")],
    eases: [
      item("e1", "Offline", { links: ["p1"] }),
      item("e2", "Cards", { links: ["p2"] }),
      item("e3", "Idle"),
    ],
    adds: [item("a1", "Payout", { links: ["g1"] })],
  });

  it("counts pains eased and gains added, idle offer lines and what is known", () => {
    const m = fitMeter(c, [{ id: "h-ok", status: "validated" }]);
    expect(m).toEqual({
      pains: { eased: 2, total: 3 },
      gains: { added: 1, total: 2 },
      uneased: ["p3"],
      idle: 1,
      confirmed: 2,
    });
    expect(fitMeter(c, [{ id: "h-ok", status: "running" }]).confirmed).toBe(1);
    expect(fitLine(m)).toContain(FIT_NOTE);
    expect(fitLine(m)).toMatch(/^2 of 3 pains eased, 1 of 2 gains added/);
  });
});

describe("the Lean UX hypothesis", () => {
  const c = canvas("lean-ux", {
    outcomes: [item("o1", "More payments with no signal")],
    users: [item("u1", "Stall holders in market halls")],
    benefits: [item("b1", "Keep selling when the signal drops")],
    solutions: [item("s1", "A queue that keeps payments")],
  });
  const picks = { users: "u1", benefits: "b1", solutions: "s1", outcomes: "o1" };

  it("writes our own sentence, not Gothelf's We believe … if template", () => {
    const s = hypothesisSentence({
      users: "stall holders",
      benefit: "Keep selling",
      solution: "a queue",
      outcome: "more sales.",
    });
    expect(s).toBe("Stall holders will keep selling with a queue, and we'll see more sales.");
    expect(s).not.toMatch(/we believe/i);
  });

  it("adds a hypothesis linked to its four picks, refusing a missing pick or a repeat", () => {
    const w = ok(withHypothesis(c, picks, NOW, () => "h1"));
    const h = w.canvas.sections.hypotheses[0];
    expect(h.links).toEqual(["u1", "b1", "s1", "o1"]);
    expect(hypothesisPicks(w.canvas, h).outcomes?.id).toBe("o1");
    expect(withHypothesis(w.canvas, picks, NOW)).toMatchObject({ ok: false, reason: "bad_field" });
    expect(withHypothesis(c, { ...picks, users: "nope" }, NOW)).toMatchObject({
      ok: false,
      reason: "blank",
    });
  });

  it("refuses a hypothesis longer than a line holds", () => {
    const long = canvas("lean-ux", {
      ...c.sections,
      solutions: [item("s1", "s".repeat(150))],
    });
    expect(withHypothesis(long, picks, NOW)).toMatchObject({ ok: false, reason: "too_long" });
  });
});

describe("the PR/FAQ", () => {
  it("counts the press release's words and the headline's", () => {
    const c = canvas("pr-faq", {
      headline: [item("h", "Tapline lets stall holders take cards")],
      summary: [item("s", "From today, stall holders can take cards.")],
      "customer-faq": [item("q", "Not counted in the release at all")],
    });
    expect(releaseWords(c)).toEqual({ words: 13, headline: 6 });
    expect(wordCount("  one — two  3 ")).toBe(3);
  });

  it("knows each hard question asked by its id, and answered by its answer", () => {
    const c = canvas("pr-faq", {
      "internal-faq": [
        item("a", "Cost?", { promptId: "hq-cost", detail: "Two people" }),
        item("b", "Risk?", { promptId: "hq-risk" }),
      ],
    });
    const qs = hardQuestions(c);
    expect(qs.find((q) => q.id === "hq-cost")).toMatchObject({ asked: true, answered: true });
    expect(qs.find((q) => q.id === "hq-risk")).toMatchObject({ asked: true, answered: false });
    expect(qs.filter((q) => q.asked)).toHaveLength(2);
  });

  it("checks a launch date: a real day, and not past when typed", () => {
    expect(validateLaunchDate("", "2026-11-23")).toEqual({ ok: true, values: "" });
    expect(validateLaunchDate("2027-02-30", "2026-11-23").ok).toBe(false);
    expect(validateLaunchDate("next week", "2026-11-23").ok).toBe(false);
    expect(validateLaunchDate("2026-11-01", "2026-11-23", { typed: true }).ok).toBe(false);
    expect(validateLaunchDate("2026-11-01", "2026-11-23")).toEqual({
      ok: true,
      values: "2026-11-01",
    });
    expect(validateLaunchDate(" 2026-12-01 ", "2026-11-23", { typed: true })).toEqual({
      ok: true,
      values: "2026-12-01",
    });
  });
});

describe("validators", () => {
  it("need a name and a line within their caps", () => {
    expect(validateCanvasTitle(" ")).toMatchObject({ ok: false });
    expect(validateCanvasTitle("x".repeat(201))).toMatchObject({ ok: false });
    expect(validateCanvasTitle(" Tapline ")).toEqual({ ok: true, values: "Tapline" });
    const def = PRODUCT_FORMATS["vision-board"]!.sections[1];
    expect(validateItem("", def)).toMatchObject({ ok: false });
    expect(validateItem("x".repeat(201), def)).toMatchObject({ ok: false });
    expect(validateItem(" A\nB ", def)).toEqual({ ok: true, values: "A B" });
  });
});

describe("gaps", () => {
  const texts = (c: ProductCanvas, ctx = {}) => canvasGaps(c, ctx).map((g) => g.text);

  it("flags empty required boxes and [placeholders] on every format", () => {
    const g = texts(canvas("value-proposition", { jobs: [item("j", "Get [what] done")] }));
    expect(g).toContain('"The customer group" is empty.');
    expect(g).toContain('A line in "Jobs they do" still has a [placeholder] to fill in.');
  });

  it("flags an evidence box that is all untested guesses, not one with a fact or a test", () => {
    const guesses = canvas("vision-board", {
      who: [item("a", "Cleaners", { evidence: "assumption" })],
    });
    expect(texts(guesses).some((t) => t.startsWith('Everything in "Who it\'s for"'))).toBe(true);
    const tested = canvas("vision-board", {
      who: [item("a", "Cleaners", { sentTo: [link("h1")] })],
    });
    expect(
      texts(tested, { hypotheses: [{ id: "h1", status: "invalidated" }] }).some((t) =>
        t.startsWith("Everything in")
      )
    ).toBe(false);
  });

  it("notices a canvas that shares no word with the Product Goal", () => {
    const c = canvas("vision-board", {
      who: [item("a", "Gardeners", { evidence: "fact" })],
      needs: [item("b", "Water plants", { evidence: "fact" })],
      product: [item("c", "Hose timer")],
    });
    const goal = {
      statement: "Shop owners take payments on their phone",
      why: "Card machines cost too much",
    };
    expect(texts(c, { goal })).toContain(
      "Nothing here uses the Product Goal's words. Check that this canvas serves the goal."
    );
    const shared = {
      ...c,
      sections: { ...c.sections, product: [item("c", "Payment on a phone")] },
    };
    expect(texts(shared, { goal }).some((t) => t.startsWith("Nothing here"))).toBe(false);
  });

  it("checks a Vision Board's vision, groups, gains and pitch", () => {
    const c = canvas("vision-board", {
      vision: [item("v", `An app that ${"helps ".repeat(25)}people`)],
      who: ["A", "B", "C", "D"].map((x) => item(x, `Group ${x}`, { evidence: "fact" })),
      gains: [item("g", "More shops", { evidence: "fact" })],
      "pitch-difference": [item("d", "It is seamless")],
    });
    const g = texts(c);
    expect(g.some((t) => /^The vision runs to \d+ words/.test(t))).toBe(true);
    expect(g).toContain('The vision names a feature ("app"). Say what changes for people instead.');
    expect(g).toContain('"Who it\'s for" names 4 groups. Pick the 3 that matter most.');
    expect(g).toContain('No line in "What we get from it" has a number. Add one you can measure.');
    expect(g).toContain('The pitch says "seamless". Say plainly what changes instead.');
  });

  it("checks a Value Proposition's uneased pains and idle offer lines", () => {
    const c = canvas("value-proposition", {
      pains: [
        item("p1", "No signal", { evidence: "fact" }),
        item("p2", "Rent", { evidence: "fact" }),
      ],
      eases: [item("e1", "Offline", { links: ["p1"] }), item("e2", "Nothing")],
    });
    const g = texts(c);
    expect(g).toContain("1 pain has nothing that eases it.");
    expect(g).toContain("1 line on the offer side links to no pain or gain.");
  });

  it("checks a Lean UX hypothesis's test and send", () => {
    const c = canvas("lean-ux", {
      hypotheses: [
        item("h1", "Stall holders will sell more", { sentTo: [link("t1")] }),
        item("h2", "Cleaners will book"),
      ],
      "smallest-test": [item("s1", "Ten stalls", { links: ["h1"] })],
    });
    const g = texts(c, { hypotheses: [{ id: "t1", status: "drafted" }] });
    expect(g).toContain('"Cleaners will book" has no smallest test yet.');
    expect(g).toContain('"Cleaners will book" isn\'t in the Hypothesis Tracker yet.');
    expect(g.some((t) => t.startsWith('"Stall holders will sell more"'))).toBe(false);
  });

  it("checks a PR/FAQ's date, length, headline and hard questions", () => {
    const words = "word ".repeat(610);
    const c = canvas("pr-faq", {
      headline: [
        item("h", "one two three four five six seven eight nine ten eleven twelve thirteen"),
      ],
      "launch-date": [item("d", "2026-11-01")],
      summary: [item("s", words)],
      "internal-faq": [item("q", "Cost?", { promptId: "hq-cost" })],
    });
    const g = texts(c, { today: "2026-11-23" });
    expect(g).toContain("The launch date 2026-11-01 has passed. Move it, or say what launched.");
    expect(g.some((t) => /^The press release runs to \d+ words/.test(t))).toBe(true);
    expect(g).toContain("The headline has 13 words. Keep it to 12 or fewer.");
    expect(g).toContain("7 hard questions aren't asked yet. Add them to the internal questions.");
    expect(g).toContain("1 hard question has no answer yet.");
    expect(texts(canvas("pr-faq"))).toContain("The press release has no launch date.");
    expect(texts(canvas("pr-faq", { "launch-date": [item("d", "soon")] }))).toContain(
      "The launch date isn't a day (YYYY-MM-DD)."
    );
  });

  it("says the same from the gap view as from the canvas", () => {
    const c = canvas("value-proposition", {
      pains: [item("p1", "No signal")],
      eases: [item("e1", "Offline", { links: ["p1"] })],
    });
    expect(gapsOf(gapViewOf(c, { today: "2026-11-23" }))).toEqual(
      canvasGaps(c, { today: "2026-11-23" })
    );
    expect(gapViewOf(c).lists.pains[0]).toEqual({
      text: "No signal",
      linked: true,
      answered: false,
    });
  });
});

describe("productCanvasWriteProblems (the CRUD's guard, wired at landing)", () => {
  it("passes a sound write", () => {
    const c = canvas("value-proposition", {
      pains: [item("p1", "No signal", { evidence: "fact" })],
      eases: [item("e1", "Offline", { links: ["p1"] })],
    });
    expect(productCanvasWriteProblems(c, null)).toEqual([]);
    expect(productCanvasWriteProblems(c, c)).toEqual([]);
  });

  it("refuses a changed format, and a format the entity doesn't know", () => {
    expect(productCanvasWriteProblems(canvas("pr-faq"), canvas("vision-board"))).toEqual([
      "A canvas keeps its format. Make a new PR/FAQ canvas instead.",
    ]);
    expect(productCanvasWriteProblems(canvas("shape-up"), canvas("idea"))).toEqual([
      "A canvas keeps its format. Make a new shape-up canvas instead.",
    ]);
    expect(productCanvasWriteProblems(canvas("lean-canvas" as ProductCanvasFormat), null)).toEqual([
      '"lean-canvas" isn\'t a Product Canvas format.',
    ]);
  });

  it("passes a canvas in a format still to come as it is: the page leaves that row alone", () => {
    // P2.3b's formats: no catalog to check them against yet, and nothing a save would drop.
    const later = canvas("shape-up", {
      problem: [item("p1", "Refunds need a call", { detail: "40 calls a week" })],
    });
    expect(
      productCanvasWriteProblems({ ...later, appetiteWeeks: 6, bet: { status: "bet" } }, null)
    ).toEqual([]);
    expect(readCanvas(later)).toBeNull();
  });

  it("names what the page would drop: boxes, caps, marks, answers, links, ids and fields", () => {
    const problems = productCanvasWriteProblems(
      {
        ...canvas("value-proposition", {
          nope: [item("x", "Lost")],
          customer: [item("c1", "A"), item("c2", "B")],
          pains: [item("p1", "x".repeat(ITEM_MAX + 1), { detail: "no" }), item("p1", "Twice")],
          offer: [
            item("o1", "Tap", {
              evidence: "fact",
              links: ["p1"],
              promptId: "hq-cost",
              niceToHave: true,
            }),
          ],
          eases: [item("e1", "Offline", { links: ["gone"] })],
        }),
        bet: { status: "bet" },
      },
      null
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "A Value Proposition has no bet.",
        'A Value Proposition has no box called "nope".',
        '"The customer group" holds one answer; this write has 2.',
        'A line in "What gets in the way" is over 200 characters.',
        '"What gets in the way" holds no answers.',
        'Two lines share the id "p1".',
        '"What we offer" doesn\'t mark lines as facts or guesses.',
        'A line in "What we offer" names a hard question it can\'t ask.',
        'Lines in "What we offer" aren\'t marked nice to have.',
        'Lines in "What we offer" don\'t link to others.',
        'A line in "Eases a pain" links to a line that isn\'t there.',
      ])
    );
  });
});
