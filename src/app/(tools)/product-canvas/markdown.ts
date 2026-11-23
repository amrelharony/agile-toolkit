/**
 * Product Canvas as Markdown, for the export menu: the canvas on screen.
 * The boxes go through the sectioned kit's `sectionsMarkdown`: each line
 * says whether it is a fact or a guess, an ease names the pain it eases,
 * and a question carries its answer. Then what the format works out (the
 * pitch, the fit, the press release's words), the Open questions, and the
 * format's credit last.
 */

import { creditLine, creditUrl, sectionsMarkdown } from "@/lib/sectioned/model";
import {
  fitLine,
  fitMeter,
  formatOf,
  itemsOf,
  pitchOf,
  pitchSentence,
  releaseWords,
} from "@/lib/product-canvas/model";
import { QUESTIONS_SECTION, RELEASE_WORDS_AIM } from "@/lib/product-canvas/formats";
import type {
  Hypothesis,
  ProductCanvas,
  ProductCanvasItem,
  ProductGoal,
} from "@/lib/stores/workspace-types";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const short = (text: string, max = 60) => {
  const t = oneLine(text);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export interface CanvasMarkdownOptions {
  /** The Product Goal the canvas serves (an example canvas: the example's). */
  goal?: Pick<ProductGoal, "statement"> | null;
  hypotheses?: readonly Pick<Hypothesis, "id" | "status">[];
}

export function canvasToMarkdown(canvas: ProductCanvas, opts: CanvasMarkdownOptions = {}): string {
  const format = formatOf(canvas);
  const textOf = (sectionId: string, id: string) =>
    itemsOf(canvas, sectionId).find((i) => i.id === id)?.text ?? "";
  const linkedText = (def: (typeof format.sections)[number], item: ProductCanvasItem) =>
    (item.links ?? [])
      .map((id) => {
        for (const s of def.linksTo ?? []) {
          const t = textOf(s, id);
          if (t) return short(t);
        }
        return "";
      })
      .filter(Boolean);
  const itemLine = (item: ProductCanvasItem, def: (typeof format.sections)[number]) => {
    if (def.kind !== "list") return item.text;
    const parts = [oneLine(item.text)];
    if (def.qa) return item.detail ? `Q: ${parts[0]} A: ${oneLine(item.detail)}` : `Q: ${parts[0]}`;
    if (def.evidence) parts.push(item.evidence === "fact" ? "(fact)" : "(guess)");
    const linked = def.id === "hypotheses" ? [] : linkedText(def, item);
    if (linked.length > 0) {
      const verb = def.id === "eases" ? "eases" : def.id === "adds" ? "adds" : "for";
      parts.push(`(${verb}: ${linked.join("; ")})`);
    }
    return parts.join(" ");
  };
  /** The boxes of `defs` through the kit, the credit left for the very end. */
  const boxes = (defs: typeof format.sections) =>
    sectionsMarkdown<ProductCanvasItem, (typeof format.sections)[number]>(
      { ...format, sections: defs, credit: undefined },
      canvas.sections,
      { itemLine }
    );
  const body = boxes(format.sections.filter((d) => d.id !== QUESTIONS_SECTION));
  const questions = boxes(format.sections.filter((d) => d.id === QUESTIONS_SECTION));
  const blocks = [`# ${oneLine(canvas.title)}`, `Format: ${format.name}`];
  const goal = opts.goal?.statement.trim();
  blocks.push(goal ? `Product Goal: ${oneLine(goal)}` : "Product Goal: not written yet");
  if (body) blocks.push(body);
  if (canvas.format === "vision-board") {
    const pitch = pitchSentence(pitchOf(canvas));
    if (pitch) blocks.push("## The pitch", pitch);
  }
  if (canvas.format === "value-proposition") {
    blocks.push("## Fit", fitLine(fitMeter(canvas, opts.hypotheses)));
  }
  if (canvas.format === "pr-faq") {
    const words = releaseWords(canvas);
    blocks.push(
      `Press release: ${words.words} words (about ${RELEASE_WORDS_AIM} is the aim); headline: ${words.headline} words.`
    );
  }
  // Open questions come last, then the format's credit.
  if (questions) blocks.push(questions);
  if (format.credit) {
    const url = creditUrl(format.credit);
    blocks.push(url ? `${creditLine(format.credit)} · ${url}` : creditLine(format.credit));
  }
  return blocks.join("\n\n");
}

/** The export when no canvas is open. */
export function emptyMarkdown(): string {
  return "# Product Canvas\n\nNo canvas yet.";
}
