/**
 * What a product canvas sends: a guess and a Lean UX hypothesis go to the
 * Hypothesis Tracker with the line's id and, in `doc`, the canvas, so the
 * tracker's "From product canvas" opens that canvas. No owner or other
 * name goes, and the example is never sent.
 */

import { describe, expect, it } from "vitest";
import { guessHypothesisSource, leanUxHypothesisSource } from "@/lib/product-canvas/sends";
import { canSend, isGuess } from "@/lib/product-canvas/model";
import { PRODUCT_FORMATS } from "@/lib/product-canvas/formats";
import { hypothesisFromSource } from "@/lib/hypotheses/model";
import { sourceHref, sourceLabel } from "@/lib/handoffs/registry";
import type { ProductCanvas, ProductCanvasItem } from "@/lib/stores/workspace-types";

const item = (
  id: string,
  text: string,
  over: Partial<ProductCanvasItem> = {}
): ProductCanvasItem => ({
  id,
  text,
  ...over,
});

const canvas = (over: Partial<ProductCanvas>): ProductCanvas => ({
  id: "pcanvas_abc",
  format: "lean-ux",
  title: "Queue",
  sections: {},
  createdAt: "2026-11-23T10:00:00.000Z",
  updatedAt: "2026-11-23T10:00:00.000Z",
  ...over,
});

describe("a guess sent to be tested", () => {
  it("carries its words as the belief and names its line and canvas", () => {
    const c = canvas({ format: "vision-board" });
    const src = guessHypothesisSource(
      c,
      item("w1", "We believe stall holders want cards", { owner: "Sam" })
    );
    expect(src).toEqual({
      title: "stall holders want cards",
      sourceRef: { tool: "product-canvas", id: "w1", doc: "pcanvas_abc" },
    });
    expect(JSON.stringify(src)).not.toContain("Sam");
  });

  it("opens its canvas from the tracker", () => {
    const ref = guessHypothesisSource(canvas({}), item("w1", "x")).sourceRef;
    expect(sourceLabel(ref)).toBe("From product canvas");
    expect(sourceHref(ref)).toBe("/product-canvas?canvas=pcanvas_abc");
  });

  it("is offered on lines of a fact-or-guess box that aren't marked fact", () => {
    const who = PRODUCT_FORMATS["vision-board"]!.sections.find((d) => d.id === "who")!;
    const product = PRODUCT_FORMATS["vision-board"]!.sections.find((d) => d.id === "product")!;
    expect(isGuess(who, item("a", "x"))).toBe(true);
    expect(isGuess(who, item("a", "x", { evidence: "assumption" }))).toBe(true);
    expect(isGuess(who, item("a", "x", { evidence: "fact" }))).toBe(false);
    expect(isGuess(product, item("a", "x"))).toBe(false);
  });

  it("never goes from the example, nor with a [placeholder] left", () => {
    expect(canSend(canvas({}), item("a", "Stall holders"))).toBe(true);
    expect(canSend(canvas({ id: "example-pc" }), item("a", "Stall holders"))).toBe(false);
    expect(canSend(canvas({}), item("a", "[Who] at markets"))).toBe(false);
    expect(canSend(canvas({}), item("a", "  "))).toBe(false);
  });
});

describe("a Lean UX hypothesis sent to be tested", () => {
  const c = canvas({
    sections: {
      outcomes: [item("o1", "More payments with no signal")],
      users: [item("u1", "Stall holders")],
      benefits: [item("b1", "keep selling")],
      solutions: [item("s1", "An offline queue")],
      hypotheses: [
        item(
          "h1",
          "Stall holders will keep selling with an offline queue, and we'll see more payments.",
          {
            links: ["u1", "b1", "s1", "o1"],
          }
        ),
        item("h2", "Cleaners will book", { links: [] }),
      ],
      "learn-first": [item("l1", "Whether buyers trust a waiting payment", { links: ["h1"] })],
      "smallest-test": [item("t1", "Ten stalls for two weekends", { links: ["h1"] })],
    },
  });

  it("brings what we'll do, the test, the metric and what to learn", () => {
    const src = leanUxHypothesisSource(c, c.sections.hypotheses[0]);
    expect(src).toEqual({
      title: "Stall holders will keep selling with an offline queue, and we'll see more payments.",
      description: "Whether buyers trust a waiting payment",
      hypothesis: {
        willDo: "An offline queue",
        experiment: "Ten stalls for two weekends",
        successMetric: "More payments with no signal",
      },
      sourceRef: { tool: "product-canvas", id: "h1", doc: "pcanvas_abc" },
    });
    const h = hypothesisFromSource(src, "hyp1", "2026-11-23");
    expect(h).toMatchObject({
      believe: src.title,
      toLearn: "Whether buyers trust a waiting payment",
      willDo: "An offline queue",
      experiment: "Ten stalls for two weekends",
      successMetric: "More payments with no signal",
      sourceRef: src.sourceRef,
    });
  });

  it("leaves out the parts it doesn't have, for the tracker to ask", () => {
    expect(leanUxHypothesisSource(c, c.sections.hypotheses[1])).toEqual({
      title: "Cleaners will book",
      sourceRef: { tool: "product-canvas", id: "h2", doc: "pcanvas_abc" },
    });
  });
});
