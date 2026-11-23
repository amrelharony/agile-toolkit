// @vitest-environment node
/**
 * Product Canvas's format catalog: the four formats P2.3a builds, each a
 * sound sectioned-kit format (the kit's own checks), with Open questions,
 * a credit and starter lines; links that name a list in the same format;
 * and few enough boxes for the AI inputs' caps.
 */

import { describe, expect, it } from "vitest";
import { formatProblems } from "@/lib/sectioned/model";
import {
  BUILT_FORMATS,
  FEATURE_WORDS,
  HARD_QUESTIONS,
  JARGON_WORDS,
  PRESS_RELEASE_SECTIONS,
  PRODUCT_FORMATS,
  QUESTIONS_SECTION,
  isHardQuestionId,
  productFormat,
  sectionDef,
} from "@/lib/product-canvas/formats";
import { PRODUCT_CANVAS_FORMATS } from "@/lib/stores/workspace-types";
import { DRAFT_FIELDS_MAX, DRAFT_SECTIONS_MAX } from "@/lib/product-canvas/starter";

const formats = BUILT_FORMATS.map((id) => PRODUCT_FORMATS[id]!);

describe("the format catalog", () => {
  it("offers the four P2.3a formats, in the entity's order, and none of P2.3b's yet", () => {
    expect(BUILT_FORMATS).toEqual(["vision-board", "value-proposition", "lean-ux", "pr-faq"]);
    for (const id of ["idea", "business-case", "shape-up"]) expect(productFormat(id)).toBeNull();
    for (const id of BUILT_FORMATS) expect(PRODUCT_CANVAS_FORMATS).toContain(id);
    expect(productFormat("constructor")).toBeNull();
    expect(productFormat(42)).toBeNull();
  });

  it.each(formats.map((f) => [f.id, f] as const))("%s passes the kit's checks", (_id, f) => {
    expect(formatProblems(f)).toEqual([]);
    expect(f.id).toBe(BUILT_FORMATS.find((id) => PRODUCT_FORMATS[id] === f));
  });

  it.each(formats.map((f) => [f.id, f] as const))(
    "%s ends with Open questions and has a credit",
    (_id, f) => {
      expect(f.sections.at(-1)?.id).toBe(QUESTIONS_SECTION);
      expect(f.credit?.text).toMatch(/^After /);
      // No licence is shown until the owner clears one (Decision D5).
      expect(f.credit?.licence).toBeUndefined();
    }
  );

  it("gives every list box a starter line, but the ones filled another way", () => {
    for (const f of formats) {
      for (const d of f.sections) {
        if (d.kind !== "list" || d.id === "hypotheses" || d.id === "internal-faq") continue;
        expect(d.starter, `${f.id}.${d.id}`).toMatch(/\[[^\]]+\]/);
      }
    }
  });

  it("links only to lists in the same format", () => {
    for (const f of formats) {
      for (const d of f.sections) {
        for (const target of d.linksTo ?? []) {
          expect(sectionDef(f, target)?.kind, `${f.id}.${d.id} → ${target}`).toBe("list");
        }
      }
    }
  });

  it("keeps each format within the AI inputs' caps: at most 10 lists and 12 other boxes", () => {
    for (const f of formats) {
      const lists = f.sections.filter((d) => d.kind === "list").length;
      expect(lists, f.id).toBeLessThanOrEqual(DRAFT_SECTIONS_MAX);
      expect(f.sections.length - lists, f.id).toBeLessThanOrEqual(DRAFT_FIELDS_MAX);
    }
  });

  it("marks facts and guesses, answers and hard questions only on lists", () => {
    for (const f of formats) {
      for (const d of f.sections) {
        if (d.evidence || d.qa || d.hardQuestions || d.linksTo) expect(d.kind, d.id).toBe("list");
      }
    }
  });

  it("has eight hard questions of our own, with unique ids", () => {
    expect(HARD_QUESTIONS).toHaveLength(8);
    expect(new Set(HARD_QUESTIONS.map((q) => q.id)).size).toBe(8);
    for (const q of HARD_QUESTIONS) {
      expect(isHardQuestionId(q.id)).toBe(true);
      expect(q.text.endsWith("?")).toBe(true);
    }
    expect(isHardQuestionId("hq-nope")).toBe(false);
  });

  it("reads the press release from the PR/FAQ's own boxes", () => {
    const f = PRODUCT_FORMATS["pr-faq"]!;
    for (const id of PRESS_RELEASE_SECTIONS) expect(sectionDef(f, id)?.group).toBe("release");
  });

  it("keeps its word lists lower case and unique", () => {
    for (const list of [JARGON_WORDS, FEATURE_WORDS]) {
      expect(new Set(list).size).toBe(list.length);
      for (const w of list) expect(w).toBe(w.toLowerCase());
    }
  });

  it("names no format with the words that would pull a whiteboard ask its way", () => {
    // test/agent/visitor-tools.test.ts ranks "add a sticky to my canvas board".
    for (const f of formats) {
      for (const d of f.sections) expect(`${d.label} ${d.prompt}`).not.toMatch(/\bsticky\b/i);
    }
  });
});
