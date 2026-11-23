// @vitest-environment node
/**
 * The golden tests for product-canvas.draft and product-canvas.gaps on the
 * three P2.3b formats (an idea, a lean business case, a Shape Up pitch): a
 * canned answer is filtered to the format's own boxes; the drafts without
 * AI start from the goal and the brief; the gaps input carries what the
 * new rules read beside the boxes (the appetite, the day a cycle ended, the
 * look-alike ideas' titles) and never who asked, the demand or a cycle's
 * number; the answer without AI says what the page's Check panel says; and
 * the largest gaps input in 3-byte text still fits the request budget.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import {
  draftInputFor,
  fitGapsInput,
  gapsInputFor,
  productCanvasDraftFallback,
  productCanvasDraftTask,
  productCanvasGapsFallback,
  productCanvasGapsTask,
  type CanvasGapsInput,
} from "@/lib/ai/tasks/product-canvas";
import { productCanvasGapsPrompt } from "@/lib/ai/tasks/product-canvas.server";
import { canvasGaps, readCanvas } from "@/lib/product-canvas/model";
import { draftOffer, starterDraft } from "@/lib/product-canvas/starter";
import type { ProductCanvas, ProductCanvasFormat } from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

const NOW = "2026-11-23T10:00:00.000Z";
const TODAY = "2026-11-23";

const canvas = (
  format: ProductCanvasFormat,
  sections: ProductCanvas["sections"] = {},
  over: Partial<ProductCanvas> = {}
): ProductCanvas =>
  readCanvas({
    id: "pcanvas_t1",
    format,
    title: "Tapline",
    sections,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  })!;

const goal = {
  statement: "Shop owners take every in-person payment on their own phone.",
  why: "Renting a card machine is the main cost our shops tell us about.",
  measures: ["Shops with no card machine: 40% today, 70% target"],
};

describe("product-canvas.draft on the three new formats", () => {
  const task = productCanvasDraftTask;

  it("keeps an idea's own boxes from a canned answer, and puts its one-line boxes in fields", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        items: [
          { section: "signal", text: "Tips on 15% of food stall payments" },
          { section: "who", text: "Food stalls", detail: "no answer belongs here" },
          { section: "pains", text: "A Value Proposition's box" },
          { section: "problem", text: "A one-line box is no list" },
        ],
        fields: [
          { id: "problem", text: "Buyers want to tip and can't" },
          { id: "idea", text: "Three tip amounts before the tap" },
          { id: "scopes", text: "A pitch's list" },
        ],
      }),
      task.output
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const offer = draftOffer(canvas("idea"), parsed.data);
    expect(offer.lines).toEqual([
      { sectionId: "problem", text: "Buyers want to tip and can't" },
      { sectionId: "idea", text: "Three tip amounts before the tap" },
      { sectionId: "who", text: "Food stalls" },
      { sectionId: "signal", text: "Tips on 15% of food stall payments" },
    ]);
    expect(offer.replaces).toEqual([]);
  });

  it("keeps a pitch's scopes and paragraphs, and offers another wording for typed text only as Replace", () => {
    const c = canvas("shape-up", { problem: [{ id: "p", text: "Refunds need a call." }] });
    const offer = draftOffer(c, {
      items: [
        { section: "scopes", text: "Refund a whole payment" },
        { section: "rabbit-holes", text: "Part refunds: whole payments only" },
      ],
      fields: [
        { id: "problem", text: "Stall holders phone us to refund a payment." },
        { id: "solution", text: "A Refund button on each payment." },
      ],
    });
    expect(offer.lines.map((l) => l.sectionId)).toEqual(["solution", "rabbit-holes", "scopes"]);
    expect(offer.replaces).toEqual([
      {
        sectionId: "problem",
        text: "Stall holders phone us to refund a payment.",
        current: "Refunds need a call.",
      },
    ]);
  });

  it("starts a business case from the goal, and an idea or a pitch from the brief", () => {
    const bc = starterDraft({
      format: "business-case",
      title: "Card-free",
      goal,
      vision: "",
      brief: "",
      fields: [],
      sections: [],
      stories: [],
    });
    expect(bc.fields.find((f) => f.id === "expect")?.text).toBe(goal.statement);
    expect(bc.items.filter((i) => i.section === "outcomes").map((i) => i.text)).toEqual(
      goal.measures
    );
    expect(bc.fields.find((f) => f.id === "epic")?.text).toMatch(/\[/);
    const ideaDraft = starterDraft({
      format: "idea",
      title: "Tips",
      vision: "",
      brief: "Buyers want to tip",
      fields: [],
      sections: [],
      stories: [],
    });
    expect(ideaDraft.fields[0]).toEqual({ id: "problem", text: "Buyers want to tip" });
    const pitchDraft = starterDraft({
      format: "shape-up",
      title: "Refunds",
      vision: "",
      brief: "Refunds need a call",
      fields: [],
      sections: [],
      stories: [],
    });
    expect(pitchDraft.fields[0]).toEqual({ id: "problem", text: "Refunds need a call" });
    for (const out of [bc, ideaDraft, pitchDraft]) {
      expect(task.output.safeParse(out).success).toBe(true);
      expect(out.items.some((i) => i.section === "questions")).toBe(false);
    }
  });

  it("never sends who asked for an idea, its demand or its note", () => {
    const c = canvas(
      "idea",
      { problem: [{ id: "p", text: "Buyers want to tip" }] },
      {
        intake: {
          requesters: ["Priya Shah"],
          source: "customer",
          demand: 7,
          status: "declined",
          note: "Asked by Priya",
        },
      }
    );
    const input = draftInputFor(c, { goal });
    expect(task.input.safeParse(input).success).toBe(true);
    expect(JSON.stringify(input)).not.toMatch(/Priya|declined|"demand"/);
    expect(productCanvasDraftFallback(input).fields.some((f) => f.id === "idea")).toBe(true);
  });
});

describe("product-canvas.gaps on the three new formats", () => {
  const task = productCanvasGapsTask;

  it("carries a pitch's appetite and the day its cycle ended, and no cycle number", () => {
    const c = canvas(
      "shape-up",
      {},
      {
        appetiteWeeks: 2,
        bet: { status: "bet", cycle: 4, start: "2026-10-05", weeks: 6 },
      }
    );
    const input = gapsInputFor(c, { today: TODAY });
    expect(input).toMatchObject({ appetiteWeeks: 2, cycleEnded: "2026-11-15" });
    expect(JSON.stringify(input)).not.toMatch(/"cycle"|"bet"/);
    expect(task.input.safeParse(input).success).toBe(true);
    const out = productCanvasGapsFallback(task.input.parse(input));
    expect(out.gaps.map((g) => g.text)).toEqual(
      canvasGaps(c, { today: TODAY })
        .slice(0, 8)
        .map((g) => g.text)
    );
    expect(out.gaps.some((g) => g.text.startsWith("Its cycle ended on 2026-11-15"))).toBe(true);
    expect(out.gaps.some((g) => g.text.startsWith("Set the appetite"))).toBe(false);
  });

  it("carries an open idea's look-alikes by title, never who asked or how many", () => {
    const mine = canvas("idea", {}, { title: "Split the bill between two cards" });
    const other = canvas(
      "idea",
      {},
      {
        id: "pcanvas_other",
        title: "Split a bill between two cards",
        intake: { requesters: ["Priya Shah"], source: "customer", demand: 9, status: "new" },
      }
    );
    const input = gapsInputFor(mine, { ideas: [mine, other] });
    expect(input.similar).toEqual(["Split a bill between two cards"]);
    expect(JSON.stringify(input)).not.toMatch(/Priya|"demand"|requesters/);
    const out = productCanvasGapsFallback(task.input.parse(input));
    expect(out.gaps.map((g) => g.text)).toEqual(
      canvasGaps(mine, { ideas: [mine, other] }).map((g) => g.text)
    );
  });

  it("answers a business case without AI as the Check panel does", () => {
    const c = canvas("business-case", { epic: [{ id: "e", text: "Card-free shops" }] });
    const out = productCanvasGapsFallback(task.input.parse(gapsInputFor(c)));
    expect(out.gaps.map((g) => g.text)).toEqual(
      canvasGaps(c)
        .slice(0, 8)
        .map((g) => g.text)
    );
    expect(out.gaps.map((g) => g.section)).toContain("mvp-cost");
  });

  it("caps the new fields: an appetite out of range or too many look-alikes is refused", () => {
    const base = task.input.parse(task.sample);
    expect(task.input.safeParse({ ...base, appetiteWeeks: 13 }).success).toBe(false);
    expect(task.input.safeParse({ ...base, similar: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(task.input.safeParse({ ...base, similar: ["x".repeat(201)] }).success).toBe(false);
    expect(task.input.safeParse({ ...base, cycleEnded: "2026-11-15T00:00" }).success).toBe(false);
  });

  it("tells the model the appetite, the cycle and the look-alikes", () => {
    const user = buildTaskUser(productCanvasGapsPrompt, {
      ...task.input.parse(task.sample),
      format: "shape-up",
      appetiteWeeks: 2,
      cycleEnded: "2026-11-15",
      fields: [],
      sections: [],
    });
    expect(user).toContain("Format: Shape Up pitch");
    expect(user).toContain("Appetite: 2 weeks");
    expect(user).toContain("Its cycle ended on 2026-11-15, and it is still bet on.");
    const idea = buildTaskUser(productCanvasGapsPrompt, {
      ...task.input.parse(task.sample),
      format: "idea",
      similar: ["Split a bill"],
      fields: [],
      sections: [],
    });
    expect(idea).toContain("Ideas in the inbox that look like it:");
    expect(idea).toContain("- Split a bill");
    expect(idea).not.toContain("Appetite");
  });

  it("fits the largest input with look-alikes, in 3-byte text, to the request budget", () => {
    const text = (n: number) => "界".repeat(n);
    const input: CanvasGapsInput = {
      format: "idea",
      title: text(200),
      goal: { statement: text(1000), why: text(1000) },
      today: TODAY,
      similar: [text(200), text(200), text(200)],
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
    expect(fitted.similar).toEqual(input.similar);
  });
});
