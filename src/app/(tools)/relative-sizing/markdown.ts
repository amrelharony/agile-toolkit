import { boardCounts, itemsIn, roomLine } from "@/lib/relative-sizing/model";
import type { SizingBoard } from "@/lib/relative-sizing/state";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One board as Markdown: its buckets with a story count and how many are
 * to talk about, then each bucket's stories (the anchor marked), the
 * stories to talk about with their moves and the room's totals, and the
 * ones not placed yet.
 */
export function toMarkdown(board: SizingBoard): string {
  const c = boardCounts(board);
  const lines = [`# Relative sizing: ${oneLine(board.title)}`, ""];
  lines.push(
    `Buckets: ${board.buckets.map((b) => b.label).join(", ")} · ${plural(c.items, "story", "stories")} · ${c.contested} to talk about`,
    ""
  );
  for (const b of board.buckets) {
    const list = itemsIn(board, { kind: "bucket", bucketId: b.id });
    lines.push(
      `## ${b.label}${b.points !== undefined ? ` (${plural(b.points, "point", "points")})` : ""}`,
      ""
    );
    if (list.length === 0) lines.push("No stories.");
    for (const i of list) {
      lines.push(`- ${oneLine(i.title)}${i.id === board.anchorItemId ? " (anchor)" : ""}`);
    }
    lines.push("");
  }
  const talk = itemsIn(board, { kind: "talk" });
  if (talk.length > 0) {
    lines.push("## To talk about", "");
    for (const i of talk) {
      const room = i.room ? roomLine(board, i.room.counts) : "";
      lines.push(
        `- ${oneLine(i.title)} (moved ${plural(i.moves, "time", "times")}${room ? `; the room: ${room}` : ""})`
      );
    }
    lines.push("");
  }
  const unplaced = itemsIn(board, { kind: "unplaced" });
  if (unplaced.length > 0) {
    lines.push("## Not placed", "");
    for (const i of unplaced) lines.push(`- ${oneLine(i.title)}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
