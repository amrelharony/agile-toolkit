import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { SizingBoard } from "../relative-sizing/state";
import { boardCounts, itemsIn, roomLine } from "../relative-sizing/model";

/**
 * A copyable prompt for the board open on the page: "Check our sizing",
 * the buckets with the stories in each and the ones still to talk about,
 * as data. No board, no prompt.
 */
export function generateRelativeSizingPrompts(board: SizingBoard | null): PromptDefinition[] {
  if (!board) return [];
  const c = boardCounts(board);
  const buckets = board.buckets.map((b) => {
    const titles = itemsIn(board, { kind: "bucket", bucketId: b.id }).map(
      (i) =>
        `   - ${sanitizePromptCell(i.title, 200)}${i.id === board.anchorItemId ? " (anchor)" : ""}`
    );
    const head = `${sanitizePromptCell(b.label, 8)}${b.points !== undefined ? ` (${b.points} points)` : ""}`;
    return [head, ...(titles.length > 0 ? titles : ["   (none)"])].join("\n");
  });
  const talk = itemsIn(board, { kind: "talk" }).map(
    (i) =>
      `- ${sanitizePromptCell(i.title, 200)}${i.room ? ` (the room: ${roomLine(board, i.room.counts)})` : ""}`
  );
  const block = [
    `Board: ${sanitizePromptCell(board.title, 120)}`,
    `Buckets, smallest first, with their stories:\n${buckets.join("\n")}`,
    talk.length > 0 ? `Still to talk about:\n${talk.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const context = `Relative sizing board with ${c.items} stories in ${board.buckets.length} buckets, ${c.contested} still to talk about.`;
  return [
    {
      id: "check-sizing",
      title: "Check our sizing",
      description: "Spot stories that look out of place next to the others in their bucket.",
      prompt:
        buildPreamble("Relative Sizing tool", context) +
        `## The board\n\n${wrapUserContent(block)}\n\n` +
        "## Questions\n\n1. Which stories look much bigger or smaller than the others in their bucket, and why?\n2. Which stories are probably too big to finish in one sprint, and how could each be split?\n3. For the stories still to talk about, what question would settle each one?\n4. Do the buckets' sizes grow evenly, or is there a jump the team should talk about?",
    },
  ];
}
