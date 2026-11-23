// @vitest-environment node
/**
 * The golden tests for product-canvas.draft and product-canvas.gaps: a
 * canned model answer is read and then filtered before anyone sees it
 * (unknown boxes, lines already there, more than a box has room for, an
 * answer outside a question list); a bad item is dropped while the rest are
 * kept; the fallbacks answer every format P2.3a offers with valid output and
 * refuse the others; the largest inputs, in 2-byte and 3-byte text, are
 * fitted to the request budget; no name goes in either input.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import {
  DRAFT_OUT_ITEMS_MAX,
  draftInputFor,
  fitDraftInput,
  fitGapsInput,
  gapsInputFor,
  productCanvasDraftFallback,
  productCanvasDraftTask,
  productCanvasGapsFallback,
  productCanvasGapsTask,
  type CanvasDraftInput,
  type CanvasGapsInput,
} from "@/lib/ai/tasks/product-canvas";
import {
  productCanvasDraftPrompt,
  productCanvasGapsPrompt,
} from "@/lib/ai/tasks/product-canvas.server";
import { BUILT_FORMATS, PRODUCT_FORMATS } from "@/lib/product-canvas/formats";
import { canvasGaps, readCanvas } from "@/lib/product-canvas/model";
import {
  DRAFT_FIELDS_MAX,
  DRAFT_SECTIONS_MAX,
  DRAFT_SECTION_LINES_MAX,
  DRAFT_STORIES_MAX,
  draftDisabledReason,
  draftOffer,
  starterDraft,
} from "@/lib/product-canvas/starter";
import type {
  ProductCanvas,
  ProductCanvasFormat,
  ProductCanvasItem,
} from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

const NOW = "2026-11-23T10:00:00.000Z";
const item = (
  id: string,
  text: string,
  over: Partial<ProductCanvasItem> = {}
): ProductCanvasItem => ({
  id,
  text,
  ...over,
});
const canvas = (
  format: ProductCanvasFormat,
  sections: ProductCanvas["sections"] = {},
  over: Partial<ProductCanvas> = {}
): ProductCanvas => ({
  id: "pcanvas_t1",
  format,
  title: "Tapline",
  sections,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const goal = {
  statement: "Shop owners take every in-person payment on their own phone.",
  why: "Renting a card machine is the main cost our shops tell us about.",
  measures: ["Shops with no card machine: 40% today, 70% target", "Payments by phone each week"],
};

describe("product-canvas.draft", () => {
  const task = productCanvasDraftTask;

  it("is a reasoning task with room for a long answer, for the owner and visitors alike", () => {
    expect(task).toMatchObject({ tier: "full", effort: "low", maxTokens: 8192 });
    expect(task.ownerOnly).toBeUndefined();
    expect(productCanvasGapsTask).toMatchObject({ tier: "full", effort: "high", maxTokens: 6144 });
  });

  it("reads a typical model answer and filters it before anyone sees it", () => {
    const answer = JSON.stringify({
      items: [
        { section: "who", text: "Stall holders at weekend markets" },
        { section: "who", text: "Mobile hairdressers" },
        { section: "who", text: "Cleaners", detail: "an answer where none belongs" },
        { section: "nope", text: "A box the format lacks" },
        { section: "vision", text: "Lists only" },
        { section: "needs", text: "Take a card with no cash about" },
      ],
      fields: [
        { id: "vision", text: "Every shop owner takes payments anywhere." },
        { id: "pitch-name", text: "Tapline Go" },
        { id: "who", text: "A list box is no field" },
      ],
    });
    const parsed = parseAnswer(`Here you go.\n${answer}`, task.output);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const c = canvas("vision-board", {
      who: [item("w1", "stall holders at weekend markets ")],
      "pitch-name": [item("n1", "Tapline")],
    });
    const offer = draftOffer(c, parsed.data);
    expect(offer.lines).toEqual([
      { sectionId: "vision", text: "Every shop owner takes payments anywhere." },
      { sectionId: "who", text: "Mobile hairdressers" },
      { sectionId: "who", text: "Cleaners" },
      { sectionId: "needs", text: "Take a card with no cash about" },
    ]);
    expect(offer.replaces).toEqual([
      { sectionId: "pitch-name", text: "Tapline Go", current: "Tapline" },
    ]);
  });

  it("keeps a box to the room it has left, and a question's answer", () => {
    const c = canvas("pr-faq", {
      "customer-faq": Array.from({ length: 14 }, (_, i) => item(`q${i}`, `Question ${i}`)),
    });
    const offer = draftOffer(c, {
      items: [
        { section: "customer-faq", text: "Does it work offline?", detail: "Yes, it waits." },
        { section: "customer-faq", text: "Does it cost more?", detail: "No." },
      ],
      fields: [],
    });
    expect(offer.lines).toEqual([
      { sectionId: "customer-faq", text: "Does it work offline?", detail: "Yes, it waits." },
    ]);
    expect(offer.dropped).toBe(1);
  });

  it("never offers words for a box only the team writes: the launch date", () => {
    const answer = JSON.stringify({
      items: [{ section: "launch-date", text: "2027-03-01" }],
      fields: [
        { id: "launch-date", text: "2027-03-01" },
        { id: "headline", text: "Tapline lets stall holders take cards" },
      ],
    });
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const offer = draftOffer(canvas("pr-faq"), parsed.data);
    expect(offer.lines).toEqual([
      { sectionId: "headline", text: "Tapline lets stall holders take cards" },
    ]);
    expect(offer.replaces).toEqual([]);
    const filled = draftOffer(canvas("pr-faq", { "launch-date": [item("d", "2027-01-01")] }), {
      items: [],
      fields: [{ id: "launch-date", text: "2027-03-01" }],
    });
    expect(filled.replaces).toEqual([]);
    expect(buildTaskSystem(task, productCanvasDraftPrompt)).toContain("Leave the launch date out");
  });

  it("drops a bad item and keeps the rest", () => {
    const answer = JSON.stringify({
      items: [
        { section: "who" },
        { section: "who", text: "Market stall holders" },
        { section: "needs", text: "x".repeat(400) },
      ],
      fields: [{ id: "vision", text: "" }],
    });
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.items[0]).toEqual({ section: "who", text: "Market stall holders" });
      // An over-long line is cut to the cap rather than lost.
      expect(parsed.data.items.slice(1).every((i) => i.text.length <= 200)).toBe(true);
      expect(parsed.data.fields).toEqual([]);
    }
  });

  it.each(BUILT_FORMATS)("answers a %s without AI with valid output", (format) => {
    const empty: CanvasDraftInput = {
      format,
      title: "Tapline",
      goal,
      vision: "Small shop owners take payments anywhere, without a card machine.",
      brief: "Stall holders lose sales with no cash about.",
      fields: [],
      sections: [],
      stories: ["Tap to pay on the phone", "Refund from the phone", "Phone receipts"],
    };
    const out = productCanvasDraftFallback(task.input.parse(empty));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.items.length + out.fields.length).toBeGreaterThan(0);
    // Nothing for the Open questions: they're the team's.
    expect(out.items.some((i) => i.section === "questions")).toBe(false);
  });

  it("starts the boxes that start from the goal with its words, the rest with starters", () => {
    const vb = starterDraft({
      format: "vision-board",
      title: "Tapline",
      goal,
      vision: "Small shops take payments anywhere.",
      brief: "",
      fields: [],
      sections: [],
      stories: ["Tap to pay on the phone", "Refund a payment from the phone"],
    });
    expect(vb.fields[0]).toEqual({ id: "vision", text: "Small shops take payments anywhere." });
    expect(vb.items.filter((i) => i.section === "gains").map((i) => i.text)).toEqual(goal.measures);
    expect(vb.items.find((i) => i.section === "product")?.text).toBe(
      "Phone: [what makes ours stand out]"
    );
    expect(vb.items.find((i) => i.section === "who")?.text).toMatch(/\[/);
    const lean = starterDraft({
      format: "lean-ux",
      title: "Queue",
      goal,
      vision: "",
      brief: "",
      fields: [],
      sections: [{ id: "outcomes", items: ["Already here"] }],
      stories: [],
    });
    expect(lean.fields).toEqual([{ id: "problem", text: goal.why }]);
    expect(lean.items.some((i) => i.section === "outcomes")).toBe(false);
    const pr = starterDraft({
      format: "pr-faq",
      title: "News",
      vision: "",
      brief: "A short brief",
      fields: [],
      sections: [],
      stories: [],
    });
    expect(pr.fields[0]).toEqual({ id: "headline", text: "A short brief" });
    expect(pr.fields.length).toBeLessThanOrEqual(8);
  });

  it("refuses the formats P2.3a doesn't build, on input and in the fallback", () => {
    const input = { ...task.sample, format: "idea" };
    expect(task.input.safeParse(input).success).toBe(false);
    expect(() => productCanvasDraftFallback(input as CanvasDraftInput)).toThrow();
    expect(() =>
      productCanvasGapsFallback({ ...productCanvasGapsTask.sample, format: "shape-up" } as never)
    ).toThrow();
  });

  it("says why it can't help yet: no goal, vision, brief or box", () => {
    const blank = draftInputFor(canvas("vision-board"), {});
    expect(draftDisabledReason(blank)).toBe(
      "Write the Product Goal, a short brief or one box first."
    );
    expect(draftDisabledReason({ ...blank, brief: "Markets" })).toBeNull();
    expect(draftDisabledReason(draftInputFor(canvas("vision-board"), { goal }))).toBeNull();
    expect(
      draftDisabledReason(draftInputFor(canvas("vision-board", { who: [item("a", "Stalls")] }), {}))
    ).toBeNull();
  });

  it("builds its input from the canvas without owners, answers' links or sends", () => {
    const c = canvas("pr-faq", {
      headline: [item("h", "Launch", { owner: "Priya Shah" })],
      "customer-faq": [
        item("q", "Offline?", {
          detail: "Yes",
          owner: "Priya Shah",
          sentTo: [{ route: "hypothesis", targetId: "t", at: NOW }],
        }),
      ],
    });
    const input = draftInputFor(c, { goal, vision: "v", brief: "b", stories: ["s"] });
    expect(task.input.safeParse(input).success).toBe(true);
    expect(input.fields).toEqual([{ id: "headline", text: "Launch" }]);
    expect(input.sections).toEqual([{ id: "customer-faq", items: ["Offline?"] }]);
    const gaps = gapsInputFor(c, { goal });
    expect(productCanvasGapsTask.input.safeParse(gaps).success).toBe(true);
    for (const json of [JSON.stringify(input), JSON.stringify(gaps)]) {
      expect(json).not.toContain("Priya");
      expect(json).not.toContain("sentTo");
      expect(json).not.toContain("targetId");
    }
  });

  it("trims the largest input, in 2-byte and 3-byte text, to fit a visitor's request", () => {
    for (const ch of ["ج", "界"]) {
      const text = (n: number) => ch.repeat(n);
      const input: CanvasDraftInput = {
        format: "pr-faq",
        title: text(200),
        goal: {
          statement: text(1000),
          why: text(1000),
          measures: Array.from({ length: 10 }, () => text(200)),
        },
        vision: text(2000),
        brief: text(500),
        fields: Array.from({ length: DRAFT_FIELDS_MAX }, (_, i) => ({
          id: `f${i}`.padEnd(40, "x"),
          text: text(600),
        })),
        sections: Array.from({ length: DRAFT_SECTIONS_MAX }, (_, i) => ({
          id: `s${i}`.padEnd(40, "x"),
          items: Array.from({ length: DRAFT_SECTION_LINES_MAX }, (_, j) => `${j}${text(199)}`),
        })),
        stories: Array.from({ length: DRAFT_STORIES_MAX }, () => text(200)),
      };
      expect(task.input.safeParse(input).success).toBe(true);
      expect(jsonBytes({ task: task.id, input })).toBeGreaterThan(TOOL_AI_BODY_BUDGET);
      const fitted = fitDraftInput(input);
      expect(task.input.safeParse(fitted).success).toBe(true);
      expect(jsonBytes({ task: task.id, input: fitted })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
      // The backlog's titles go first; each box keeps its newest line.
      expect(fitted.stories.length).toBeLessThan(input.stories.length);
      for (const s of fitted.sections) {
        const from = input.sections.find((x) => x.id === s.id)!;
        expect(s.items.at(-1)).toBe(from.items.at(-1));
      }
      expect(fitted.goal).toEqual(input.goal);
    }
    const small = task.input.parse(task.sample);
    expect(fitDraftInput(small)).toBe(small);
  });

  it("builds a prompt that lists the format's boxes from the catalog", () => {
    const system = buildTaskSystem(task, productCanvasDraftPrompt);
    expect(system).toContain("JSON");
    expect(system).toContain(`up to ${DRAFT_OUT_ITEMS_MAX} lines`);
    const user = buildTaskUser(productCanvasDraftPrompt, task.input.parse(task.sample));
    expect(user).toContain("Format: Vision Board");
    expect(user).toContain("- who: Who it's for (a list of up to 8 lines).");
    expect(user).toContain("Product Goal: Shop owners");
    expect(user).toContain("- Stall holders at weekend markets");
  });
});

describe("product-canvas.gaps", () => {
  const task = productCanvasGapsTask;

  it("reads a typical model answer; an unknown box is the page's to drop", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        gaps: [
          { section: "pains", text: "Which pain costs a stall holder the most on a Saturday?" },
          { text: "Who has said they would pay for this?" },
          { section: "pains", text: "" },
        ],
      }),
      task.output
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.gaps).toHaveLength(2);
  });

  it.each(BUILT_FORMATS)("answers a %s without AI with the page's own checks", (format) => {
    const c = readCanvas(canvas(format, { questions: [item("q", "[What we don't know]")] }))!;
    const input = gapsInputFor(c, { goal, today: "2026-11-23" });
    expect(task.input.safeParse(input).success).toBe(true);
    const out = productCanvasGapsFallback(task.input.parse(input));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.gaps.map((g) => g.text)).toEqual(
      canvasGaps(c, { goal, today: "2026-11-23" })
        .slice(0, 8)
        .map((g) => g.text)
    );
  });

  it("carries what the rules need: marks, links, answers and hard questions", () => {
    const c = canvas("pr-faq", {
      "launch-date": [item("d", "2026-11-01")],
      "internal-faq": [item("q", "Cost?", { promptId: "hq-cost", detail: "Low" })],
    });
    const input = gapsInputFor(c, { today: "2026-11-23" });
    expect(input.today).toBe("2026-11-23");
    expect(input.sections).toEqual([
      {
        id: "internal-faq",
        items: [{ text: "Cost?", linked: false, answered: true, asks: "hq-cost" }],
      },
    ]);
    const out = productCanvasGapsFallback(input);
    expect(out.gaps.some((g) => g.text.includes("has passed"))).toBe(true);
    expect(out.gaps.some((g) => g.text.startsWith("7 hard questions"))).toBe(true);
  });

  it("trims the largest input, in 2-byte and 3-byte text, to fit a visitor's request", () => {
    for (const ch of ["ج", "界"]) {
      const text = (n: number) => ch.repeat(n);
      const input: CanvasGapsInput = {
        format: "value-proposition",
        title: text(200),
        goal: { statement: text(1000), why: text(1000) },
        today: "2026-11-23",
        fields: Array.from({ length: 12 }, (_, i) => ({
          id: `f${i}`.padEnd(40, "x"),
          text: text(1000),
        })),
        sections: Array.from({ length: 10 }, (_, i) => ({
          id: `s${i}`.padEnd(40, "x"),
          items: Array.from({ length: 20 }, () => ({
            text: text(200),
            evidence: "assumption" as const,
            linked: true,
            answered: false,
            asks: "x".repeat(40),
          })),
        })),
      };
      expect(task.input.safeParse(input).success).toBe(true);
      expect(jsonBytes({ task: task.id, input })).toBeGreaterThan(TOOL_AI_BODY_BUDGET);
      const fitted = fitGapsInput(input);
      expect(task.input.safeParse(fitted).success).toBe(true);
      expect(jsonBytes({ task: task.id, input: fitted })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
      expect(fitted.goal).toEqual(input.goal);
    }
    const small = task.input.parse(task.sample);
    expect(fitGapsInput(small)).toBe(small);
  });

  it("builds a prompt that marks each line's state", () => {
    const user = buildTaskUser(productCanvasGapsPrompt, task.input.parse(task.sample));
    expect(user).toContain("Format: Value Proposition");
    expect(user).toContain("- No signal in the market hall (fact, linked)");
    expect(user).toContain("- Buyers with no cash walk away (guess, not linked)");
    const system = buildTaskSystem(task, productCanvasGapsPrompt);
    expect(system).toContain("JSON");
    // The sectioned kit's shared rules: only the listed ids, no invented names or numbers.
    expect(system).toContain("Use only the section ids listed");
    expect(system).toContain("Never invent names, dates or numbers");
  });

  it("offers only the formats in the catalog", () => {
    expect(Object.keys(PRODUCT_FORMATS).sort()).toEqual([...BUILT_FORMATS].sort());
  });
});
