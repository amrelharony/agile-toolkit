import { describe, expect, it } from "vitest";
import {
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type RootCauseAnalysis,
  type RootCauseCause,
} from "@/lib/stores/workspace-types";
import {
  DEFAULT_CATEGORIES,
  analysisDraftErrors,
  analysisStage,
  blankAnalysis,
  categoriesOf,
  causesIn,
  cleanCount,
  countermeasureSource,
  liveOnBoards,
  paretoRows,
  postMortemFactorRef,
  readAnalysis,
  rootCauseVerdict,
  sentLink,
  withCategoryRenamed,
  withCause,
  withCausePatch,
  withWhy,
  withWhyText,
} from "@/lib/root-cause/model";

/**
 * Root Cause's shared rules (lib/root-cause/model): new analyses, the why
 * chain and the fishbone within the CRUD's caps, categories, the Pareto
 * order with its vital few, where an analysis stands, and reading back a
 * stored row that could hold anything.
 */

const NOW = "2026-11-12T10:00:00.000Z";
const LATER = "2026-11-12T11:00:00.000Z";

const blank = (over: Partial<RootCauseAnalysis> = {}): RootCauseAnalysis => ({
  ...blankAnalysis({ title: "Deploys fail" }, "rca_1", NOW),
  ...over,
});
const cause = (id: string, count: number, category = "Process", text = `Cause ${id}`) =>
  ({ id, category, text, count }) satisfies RootCauseCause;

describe("a new analysis", () => {
  it("starts empty on 5 Whys, stamped, with the title cut to its cap", () => {
    const a = blankAnalysis({ title: `  ${"x".repeat(300)} ` }, "rca_1", NOW);
    expect(a.title).toHaveLength(TOOL_TEXT_MAX.short);
    expect(a.title.endsWith("…")).toBe(true);
    expect(a).toMatchObject({
      method: "five-whys",
      whys: [],
      causes: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("keeps the method, source and links it was made with", () => {
    const a = blankAnalysis(
      {
        title: "Checkout errors",
        problem: "Two hours unnoticed",
        method: "fishbone",
        sourceRef: { tool: "post-mortem", id: "factor:1", doc: "pm1" },
        postMortemId: "pm1",
      },
      "rca_2",
      NOW
    );
    expect(a).toMatchObject({
      method: "fishbone",
      problem: "Two hours unnoticed",
      postMortemId: "pm1",
      sourceRef: { tool: "post-mortem", doc: "pm1" },
    });
  });

  it("asks for a name and keeps both fields within their caps", () => {
    expect(analysisDraftErrors({ title: " ", problem: "" }).title).toMatch(/Name the problem/);
    expect(analysisDraftErrors({ title: "ok", problem: "p".repeat(1001) }).problem).toMatch(/1000/);
    expect(analysisDraftErrors({ title: "ok", problem: "" })).toEqual({});
  });
});

describe("the why chain", () => {
  it("adds whys in order and stamps the change", () => {
    const one = withWhy(blank(), " A migration failed ", "w1", LATER)!;
    const two = withWhyText(
      withWhy(one, "Never run on big data", "w2", LATER)!,
      "w1",
      "A migration failed in prod",
      LATER
    )!;
    expect(two.whys.map((w) => w.text)).toEqual([
      "A migration failed in prod",
      "Never run on big data",
    ]);
    expect(two.updatedAt).toBe(LATER);
  });

  it("refuses a blank why, an edit of a gone one, and a chain past its cap", () => {
    expect(withWhy(blank(), "   ", "w1", LATER)).toBeNull();
    expect(withWhyText(blank(), "nope", "text", LATER)).toBeNull();
    const full = blank({
      whys: Array.from({ length: TOOL_LIST_MAX.whys }, (_, i) => ({
        id: `w${i}`,
        text: `Why ${i}`,
      })),
    });
    expect(withWhy(full, "one more", "x", LATER)).toBeNull();
  });
});

describe("the fishbone", () => {
  it("files a cause under its category with a whole count, Other when blank", () => {
    const a = withCause(blank(), { category: " ", text: "No alert", count: 2.6 }, "c1", LATER)!;
    expect(a.causes[0]).toEqual({ id: "c1", category: "Other", text: "No alert", count: 3 });
    expect(cleanCount(-4)).toBe(0);
    expect(cleanCount("12")).toBe(12);
    expect(cleanCount(Number.NaN)).toBe(0);
  });

  it("patches a cause, but never to blank text", () => {
    const a = blank({ causes: [cause("c1", 1)] });
    expect(
      withCausePatch(a, "c1", { count: 5, category: "Tools" }, LATER)!.causes[0]
    ).toMatchObject({
      count: 5,
      category: "Tools",
    });
    expect(withCausePatch(a, "c1", { text: "  " }, LATER)).toBeNull();
    expect(withCausePatch(a, "gone", { count: 1 }, LATER)).toBeNull();
  });

  it("lists the six defaults first, then the team's own once each, any case", () => {
    const list = categoriesOf(
      [cause("a", 1, "process"), cause("b", 1, "Suppliers"), cause("c", 1, "suppliers")],
      ["Budget"]
    );
    expect(list).toEqual([...DEFAULT_CATEGORIES, "Suppliers", "Budget"]);
    expect(causesIn([cause("a", 1, "process"), cause("b", 1, "Tools")], "Process")).toHaveLength(1);
  });

  it("leaves out a starting category the team hid, until a cause is filed under it", () => {
    expect(categoriesOf([], [], ["people", "Tools"])).toEqual(
      DEFAULT_CATEGORIES.filter((c) => c !== "People" && c !== "Tools")
    );
    // A cause under a hidden default brings it back, in its own place.
    expect(categoriesOf([cause("a", 1, "Tools")], ["Staff"], ["People", "Tools"])).toEqual([
      ...DEFAULT_CATEGORIES.filter((c) => c !== "People"),
      "Staff",
    ]);
  });

  it("renames a category on every cause in it", () => {
    const a = blank({
      causes: [cause("a", 1, "Tools"), cause("b", 1, "tools"), cause("c", 1, "People")],
    });
    const renamed = withCategoryRenamed(a, "Tools", "Tooling", LATER)!;
    expect(renamed.causes.map((c) => c.category)).toEqual(["Tooling", "Tooling", "People"]);
    expect(withCategoryRenamed(a, "Nowhere", "X", LATER)).toBeNull();
  });
});

describe("the Pareto order", () => {
  it("puts the causes most first with the running share, and names the vital few", () => {
    const rows = paretoRows([
      cause("a", 2),
      cause("b", 6),
      cause("c", 0),
      cause("d", 1),
      cause("e", 1),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "d", "e"]);
    expect(rows.map((r) => Math.round(r.cumulative * 100))).toEqual([60, 80, 90, 100]);
    // The share before "a" is 60%, under 80, so it's vital; before "d" it is 80%.
    expect(rows.map((r) => r.vital)).toEqual([true, true, false, false]);
  });

  it("keeps the fishbone's order between equal counts, and is empty with no counts", () => {
    expect(paretoRows([cause("x", 2), cause("y", 2)]).map((r) => r.id)).toEqual(["x", "y"]);
    expect(paretoRows([cause("x", 0)])).toEqual([]);
  });
});

describe("where an analysis stands", () => {
  it("goes from looking, to a root cause, a countermeasure, then sent", () => {
    expect(analysisStage(blank())).toBe("started");
    expect(analysisStage(blank({ rootCause: "No owner" }))).toBe("root-cause");
    expect(analysisStage(blank({ rootCause: "No owner", countermeasure: "Name one" }))).toBe(
      "countermeasure"
    );
    expect(
      analysisStage(blank({ sentTo: [{ route: "retro-action", targetId: "card", at: NOW }] }))
    ).toBe("sent");
  });

  it("says what to do next across analyses", () => {
    expect(rootCauseVerdict([])).toBe("No analysis yet.");
    expect(rootCauseVerdict([blank({ rootCause: "x" })])).toMatch(/1 analysis has a root cause/);
    expect(rootCauseVerdict([blank({ rootCause: "x", countermeasure: "y" })])).toMatch(
      /isn't in Retro Actions yet/
    );
    expect(rootCauseVerdict([blank(), blank({ id: "b" })])).toMatch(/2 analyses are still looking/);
  });

  it("counts a send only while its action is still on a retro board", () => {
    const sent = blank({
      rootCause: "No owner",
      countermeasure: "Name one",
      sentTo: [{ route: "retro-action", targetId: "card-1", at: NOW }],
    });
    const live = liveOnBoards([{ cards: [{ id: "card-1" }] }]);
    const gone = liveOnBoards([{ cards: [{ id: "card-2" }] }]);
    expect(analysisStage(sent, live)).toBe("sent");
    expect(sentLink(sent, live)?.targetId).toBe("card-1");
    // The action was deleted in Retro Actions: the countermeasure is back to unsent.
    expect(analysisStage(sent, gone)).toBe("countermeasure");
    expect(sentLink(sent, gone)).toBeUndefined();
    expect(rootCauseVerdict([sent], gone)).toMatch(/isn't in Retro Actions yet/);
    // Without a way to tell, a recorded link counts.
    expect(analysisStage(sent)).toBe("sent");
    // Other routes' links aren't checked against the boards.
    expect(gone({ route: "impediment", targetId: "x", at: NOW })).toBe(true);
  });

  it("reads boards that hold anything without throwing", () => {
    const isLive = liveOnBoards([
      null,
      { cards: "nope" },
      { cards: [null, { id: 7 }, { id: "card-1" }] },
    ] as never);
    expect(isLive({ route: "retro-action", targetId: "card-1", at: NOW })).toBe(true);
    expect(isLive({ route: "retro-action", targetId: "7", at: NOW })).toBe(false);
    expect(liveOnBoards(undefined)({ route: "retro-action", targetId: "card-1", at: NOW })).toBe(
      false
    );
  });

  it("sends the countermeasure's first line, with the problem and root cause as context", () => {
    const src = countermeasureSource(
      blank({ rootCause: "No owner", countermeasure: "Name an owner\nCheck: it stops" })
    );
    expect(src.title).toBe("Name an owner");
    expect(src.description).toContain("Problem: Deploys fail");
    expect(src.description).toContain("Root cause: No owner");
  });
});

describe("a post-mortem factor's ref", () => {
  it("is the same for the same words, whatever the spacing or case", () => {
    const a = postMortemFactorRef("pm1", "No alert on errors");
    expect(a).toEqual(postMortemFactorRef("pm1", "  no alert   on ERRORS "));
    expect(a.tool).toBe("post-mortem");
    expect(a.doc).toBe("pm1");
    expect(a.id).not.toEqual(postMortemFactorRef("pm1", "Another factor").id);
  });
});

describe("reading a stored analysis back", () => {
  it("caps what is too long, drops what isn't a why or a cause, and keeps the rest", () => {
    const read = readAnalysis({
      id: "rca_9",
      title: "",
      problem: 42,
      method: "magic",
      whys: [{ id: "w1", text: "ok" }, { text: "no id" }, null, { id: "w2", text: "   " }],
      causes: [{ id: "c1", text: "x", count: -3, category: "" }, { id: "c2" }],
      rootCause: "  ",
      countermeasure: "Do it",
      updatedAt: NOW,
      postMortemId: "pm1",
    })!;
    expect(read).toMatchObject({
      title: "Untitled problem",
      problem: "",
      method: "five-whys",
      whys: [{ id: "w1", text: "ok" }],
      causes: [{ id: "c1", text: "x", count: 0, category: "Other" }],
      countermeasure: "Do it",
      postMortemId: "pm1",
    });
    expect("rootCause" in read).toBe(false);
    expect(readAnalysis(null)).toBeNull();
    expect(readAnalysis({ title: "no id" })).toBeNull();
  });

  it("rebuilds links and the source ref from known fields, so a bad row can't crash a reader", () => {
    const odd = readAnalysis({
      id: "rca_1",
      title: "x",
      sentTo: { route: "retro-action" },
      sourceRef: "post-mortem",
      postMortemId: 4,
      retroBoardId: "",
    })!;
    expect("sentTo" in odd).toBe(false);
    expect("sourceRef" in odd).toBe(false);
    expect("postMortemId" in odd).toBe(false);
    expect("retroBoardId" in odd).toBe(false);
    expect(analysisStage(odd)).toBe("started");

    const mixed = readAnalysis({
      id: "rca_2",
      title: "y",
      sentTo: [
        null,
        { route: "nowhere", targetId: "a", at: NOW },
        { route: "retro-action", targetId: "", at: NOW },
        { route: "retro-action", targetId: "card-1", at: NOW, extra: true },
      ],
      sourceRef: { tool: "post-mortem", id: "pmf_1", doc: "pm1", extra: 1 },
    })!;
    expect(mixed.sentTo).toEqual([{ route: "retro-action", targetId: "card-1", at: NOW }]);
    expect(mixed.sourceRef).toEqual({ tool: "post-mortem", id: "pmf_1", doc: "pm1" });
    expect(analysisStage(mixed)).toBe("sent");
  });
});
