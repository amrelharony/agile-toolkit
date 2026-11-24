// @vitest-environment node
/**
 * What an accepted idea, a business case and a Shape Up scope hand on
 * (P2.3b): each source's `sourceRef` names the canvas (`doc`), so the
 * target's "From product canvas" link opens it; an idea's description is
 * its problem only, never who asked; a case reaches the Decision Log with
 * its options and, once decided, the verdict as the proposal.
 */

import { describe, expect, it } from "vitest";
import { buildDecision } from "@/lib/decisions/model";
import { caseDecisionSource, ideaSource, scopeSource } from "@/lib/product-canvas/sends";
import { sourceHref } from "@/lib/handoffs/registry";
import type { ProductCanvas } from "@/lib/stores/workspace-types";

const NOW = "2026-11-23T10:00:00.000Z";

const idea: ProductCanvas = {
  id: "pcanvas_idea",
  format: "idea",
  title: "Split a bill between two cards",
  sections: {
    problem: [{ id: "p", text: "Two friends want to pay half each" }],
    who: [{ id: "w", text: "Friends at food stalls", owner: "Priya Shah" }],
  },
  intake: {
    requesters: ["Priya Shah", "Support inbox"],
    source: "customer",
    demand: 2,
    status: "accepted",
  },
  createdAt: NOW,
  updatedAt: NOW,
};

const bizCase: ProductCanvas = {
  id: "pcanvas_case",
  format: "business-case",
  title: "Card-free",
  sections: {
    epic: [{ id: "e", text: "Every payment on the owner's phone" }],
    expect: [{ id: "x", text: "Shops stop renting card machines." }],
  },
  createdAt: NOW,
  updatedAt: NOW,
};

describe("an accepted idea", () => {
  it("goes with its title and its problem, never who asked", () => {
    const src = ideaSource(idea);
    expect(src).toEqual({
      title: "Split a bill between two cards",
      description: "Two friends want to pay half each",
      sourceRef: { tool: "product-canvas", id: "pcanvas_idea", doc: "pcanvas_idea" },
    });
    expect(JSON.stringify(src)).not.toContain("Priya");
    expect(JSON.stringify(src)).not.toContain("Support inbox");
  });

  it("links back to its canvas", () => {
    expect(sourceHref(ideaSource(idea).sourceRef)).toBe("/product-canvas?canvas=pcanvas_idea");
  });

  it("goes with no description when it has no problem yet", () => {
    expect(ideaSource({ ...idea, sections: {} })).not.toHaveProperty("description");
  });
});

describe("a business case", () => {
  it("reaches the Decision Log as a proposal with its options, the verdict once there is one", () => {
    const pending = caseDecisionSource(bizCase);
    expect(pending).toEqual({
      title: "Business case: Every payment on the owner's phone",
      description: "Shops stop renting card machines.",
      decision: { template: "adr", options: ["Go", "No go", "Change and come back"] },
      sourceRef: { tool: "product-canvas", id: "pcanvas_case", doc: "pcanvas_case" },
    });
    const go = caseDecisionSource({ ...bizCase, decision: { verdict: "go" } });
    expect(go.decision?.recommendation).toBe("Go");
    const record = buildDecision(go, "dec_1", 1, "2026-11-23");
    expect(record).toMatchObject({
      title: "Business case: Every payment on the owner's phone",
      status: "proposed",
      recommendation: "Go",
    });
    expect(record.options?.map((o) => o.text)).toEqual(["Go", "No go", "Change and come back"]);
  });

  it("falls back to the canvas's name with no epic written", () => {
    expect(caseDecisionSource({ ...bizCase, sections: {} }).title).toBe("Business case: Card-free");
  });
});

describe("a Shape Up scope", () => {
  it("goes to the backlog in its own words, linked to its pitch", () => {
    const pitch: ProductCanvas = {
      id: "pcanvas_pitch",
      format: "shape-up",
      title: "Refunds",
      sections: { scopes: [{ id: "s1", text: "Refund a whole payment", niceToHave: true }] },
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(scopeSource(pitch, pitch.sections.scopes[0])).toEqual({
      title: "Refund a whole payment",
      sourceRef: { tool: "product-canvas", id: "s1", doc: "pcanvas_pitch" },
    });
  });
});
