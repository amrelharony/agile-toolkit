/**
 * A round without a meeting as Markdown, for the Export menu. Before Reveal
 * it is blind (who replied, never a card); after it, each story's votes,
 * verdict and notes. A closed round has no names or notes left, so neither
 * does its Markdown.
 */

import { asyncResults, cardCount } from "@/lib/estimation/async-pack";
import type { PokerAsyncRound } from "@/lib/stores/workspace-types";
import { SCALE_LABELS, type ScaleType } from "../types";

const STATUS: Record<PokerAsyncRound["status"], string> = {
  open: "Waiting for replies",
  revealed: "Revealed",
  closed: "Closed",
};

/** One line of Markdown text: no line breaks, no table pipes, no heading marks. */
function line(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
}

export function asyncRoundMarkdown(round: PokerAsyncRound): string {
  const scale = SCALE_LABELS[round.scaleType as ScaleType] ?? "Custom";
  const n = round.replies.length;
  const out: string[] = [
    `# ${line(round.title)}`,
    "",
    `Estimate without a meeting, ${scale} deck: ${round.deck.map(line).join(", ")}.`,
    `${STATUS[round.status]}. ${n} ${n === 1 ? "reply" : "replies"}${
      round.dueDate ? `, due ${round.dueDate}` : ""
    }.`,
    "",
  ];

  if (round.status === "open") {
    const names = round.replies.map((r) => line(r.name)).filter(Boolean);
    if (names.length > 0) out.push(`Replied: ${names.join(", ")}.`);
    const cards = cardCount(round);
    out.push(
      `${cards} ${cards === 1 ? "card" : "cards"} in, hidden until the round is revealed.`,
      ""
    );
    out.push("## Stories", "");
    round.stories.forEach((s, i) => out.push(`${i + 1}. ${line(s.title)}`));
    return `${out.join("\n")}\n`;
  }

  asyncResults(round).forEach((r, i) => {
    out.push(`## ${i + 1}. ${line(r.story.title)}`, "");
    if (r.story.finalEstimate) out.push(`- Agreed: **${line(r.story.finalEstimate)}**`);
    if (r.votes.length === 0) {
      out.push("- No cards.");
    } else {
      const votes = r.votes.map((v) => (v.name ? `${line(v.name)} ${v.card}` : v.card));
      out.push(`- Cards: ${votes.join(", ")}`);
      if (r.label) out.push(`- ${r.label}: ${r.verdict}`);
    }
    for (const note of r.notes) {
      out.push(`- Note${note.name ? ` from ${line(note.name)}` : ""}: ${line(note.text)}`);
    }
    out.push("");
  });
  return `${out.join("\n").trimEnd()}\n`;
}
