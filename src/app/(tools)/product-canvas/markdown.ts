/**
 * Product Canvas as Markdown, for the export menu: what is on screen.
 *
 * One canvas: the boxes go through the sectioned kit's `sectionsMarkdown`:
 * each line says whether it is a fact or a guess, an ease names the pain it
 * eases, a question carries its answer and a nice-to-have scope its "~".
 * Then what the format works out (the pitch, the fit, the press release's
 * words, an idea's intake, a case's decision, a pitch's appetite and bet),
 * the Open questions, and the format's credit last.
 *
 * The idea inbox (`inboxToMarkdown`) by status, with demand; who asked only
 * when "Include who asked" is ticked. The betting table
 * (`bettingTableToMarkdown`): each cycle with its dates and bets, then the
 * pitches on the table and those passed on.
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
import {
  BET_STATUS_LABEL,
  IDEA_SOURCE_LABEL,
  IDEA_STATUS_LABEL,
  VERDICT_LABEL,
  cycleEnd,
  cycleName,
  verdictOf,
} from "@/lib/product-canvas/fields";
import { bettingTable, cycles } from "@/lib/product-canvas/bets";
import { inboxView, rootOf } from "@/lib/product-canvas/intake";
import {
  PRODUCT_IDEA_STATUSES,
  type Hypothesis,
  type ProductCanvas,
  type ProductCanvasItem,
  type ProductGoal,
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
  /** An idea: name who asked ("Include who asked"). */
  withRequesters?: boolean;
  /** The canvases beside it: the idea a merged one went into. */
  canvases?: readonly ProductCanvas[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An idea's intake as one line: status, demand, where from, and who asked when wanted. */
function intakeLine(c: ProductCanvas, opts: { withRequesters?: boolean; into?: string }): string {
  const intake = c.intake;
  if (!intake) return "";
  const parts = [
    `Status: ${IDEA_STATUS_LABEL[intake.status]}${opts.into ? ` into “${short(opts.into)}”` : ""}`,
    `asked for ${plural(intake.demand, "time")}`,
    `from ${IDEA_SOURCE_LABEL[intake.source].toLowerCase()}`,
  ];
  if (opts.withRequesters && intake.requesters.length > 0) {
    parts.push(`asked by ${intake.requesters.map(oneLine).join(", ")}`);
  }
  return `${parts.join("; ")}.`;
}

/** A pitch's bet as one line: where it stands, its cycle and its dates. */
function betLine(c: ProductCanvas): string {
  const bet = c.bet;
  if (!bet) return `Betting table: ${BET_STATUS_LABEL.table}.`;
  const end = cycleEnd(bet.start, bet.weeks);
  const cycle =
    bet.cycle !== undefined
      ? ` in ${cycleName(bet.cycle)}${bet.start && end ? `, ${bet.start} to ${end}` : ""}`
      : "";
  return `Betting table: ${BET_STATUS_LABEL[bet.status]}${cycle}.`;
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
    if (def.niceToHave && item.niceToHave) parts[0] = `~ ${parts[0]} (nice to have)`;
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
  if (canvas.format === "idea") {
    const into =
      canvas.intake?.status === "merged" && opts.canvases
        ? rootOf(canvas.id, opts.canvases)?.title
        : undefined;
    blocks.push(
      intakeLine(canvas, {
        withRequesters: opts.withRequesters,
        ...(into && into !== canvas.title ? { into } : {}),
      })
    );
    if (canvas.intake?.note) blocks.push(`Note: ${oneLine(canvas.intake.note)}`);
  }
  if (canvas.format === "business-case") {
    const verdict = verdictOf(canvas);
    const day = canvas.decision?.decidedAt?.slice(0, 10);
    const note = canvas.decision?.note;
    blocks.push(
      `Decision: ${VERDICT_LABEL[verdict]}${verdict !== "pending" && day ? ` (${day})` : ""}.${note ? ` ${oneLine(note)}` : ""}`
    );
  }
  if (canvas.format === "shape-up") {
    const weeks = canvas.appetiteWeeks;
    blocks.push(
      weeks !== undefined ? `Appetite: ${plural(weeks, "week")}.` : "Appetite: not set yet.",
      betLine(canvas)
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

/**
 * The idea inbox: a heading per status that holds ideas, each idea with
 * how many asked for it and where it came from, most asked for first. Who
 * asked is left out unless `withRequesters` (the page's "Include who
 * asked"); a merged idea names the idea it went into.
 */
export function inboxToMarkdown(
  canvases: readonly ProductCanvas[],
  opts: { withRequesters?: boolean } = {}
): string {
  const blocks = ["# Idea inbox"];
  const all = inboxView(canvases, "all");
  if (all.length === 0) return `${blocks[0]}\n\nNo ideas yet.`;
  for (const status of PRODUCT_IDEA_STATUSES) {
    const ideas = all.filter((c) => (c.intake?.status ?? "new") === status);
    if (ideas.length === 0) continue;
    const lines = ideas.map((c) => {
      const intake = c.intake!;
      const parts = [
        `asked for ${plural(intake.demand, "time")}`,
        `from ${IDEA_SOURCE_LABEL[intake.source].toLowerCase()}`,
      ];
      if (status === "merged") {
        const root = rootOf(c.id, canvases);
        if (root && root.id !== c.id) parts.push(`merged into “${short(root.title)}”`);
      }
      if (opts.withRequesters && intake.requesters.length > 0) {
        parts.push(`asked by ${intake.requesters.map(oneLine).join(", ")}`);
      }
      return `- ${oneLine(c.title)} (${parts.join("; ")})`;
    });
    blocks.push(`## ${IDEA_STATUS_LABEL[status]} (${ideas.length})`, lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/**
 * The betting table: each cycle, newest first, with its dates and every
 * pitch bet on it (its appetite and where it stands), then the pitches on
 * the table and those not bet on this time.
 */
export function bettingTableToMarkdown(canvases: readonly ProductCanvas[]): string {
  const blocks = ["# Betting table"];
  const appetite = (c: ProductCanvas) =>
    c.appetiteWeeks !== undefined ? `, appetite ${plural(c.appetiteWeeks, "week")}` : "";
  const line = (c: ProductCanvas) =>
    `- ${oneLine(c.title)} (${BET_STATUS_LABEL[c.bet?.status ?? "table"]}${appetite(c)})`;
  const cy = cycles(canvases);
  for (const cycle of cy) {
    const dates =
      cycle.start && cycle.end
        ? `${cycle.start} to ${cycle.end}, ${plural(cycle.weeks ?? 0, "week")}`
        : "no dates yet";
    blocks.push(`## ${cycle.name} (${dates})`, cycle.bets.map(line).join("\n"));
  }
  // Pitches in no cycle: on the table, and any passed on or finished without one.
  const table = bettingTable(canvases);
  const loose = (list: ProductCanvas[]) => list.filter((c) => c.bet?.cycle === undefined);
  const rest: [string, ProductCanvas[]][] = [
    ["On the table", table.table],
    ["Not this time", loose(table.passed)],
    ["Done", loose(table.done)],
    ["Bet, no cycle yet", loose(table.bet)],
  ];
  for (const [title, list] of rest) {
    if (list.length > 0) blocks.push(`## ${title}`, list.map(line).join("\n"));
  }
  if (blocks.length === 1) blocks.push("No pitches yet.");
  return blocks.join("\n\n");
}
