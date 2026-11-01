/**
 * The per-statement radar in words: a one-sentence summary and each
 * statement's score in the round shown and the one it is compared with.
 * Pure, so it is ready before the chart draws.
 */

import { NO_VALUE, cell, fmt, type ChartText } from "@/lib/charts/chart-text";
import { questionLabel, type RoundResult } from "@/lib/psych-safety/instrument";

export function radarText(
  cur: RoundResult,
  curName: string,
  prev: RoundResult | null,
  prevName: string | null
): ChartText {
  const shown = cur.perQuestion.filter((q) => q.adjusted !== null);
  const sorted = [...shown].sort((a, b) => (a.adjusted as number) - (b.adjusted as number));
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  let summary =
    shown.length === 0
      ? `${curName}: no statement has enough answers to show.`
      : `${curName}: scores range from ${fmt(low.adjusted as number)} (${questionLabel(low.id)}) to ${fmt(high.adjusted as number)} (${questionLabel(high.id)}) out of 5.`;
  if (prev && prevName && prev.teamScore !== null && cur.teamScore !== null) {
    summary += ` The team score went from ${fmt(prev.teamScore)} in ${prevName} to ${fmt(cur.teamScore)}.`;
  }
  return {
    summary,
    table: {
      caption: "Score per statement (1 to 5, higher is safer)",
      columns: ["Statement", curName, ...(prev && prevName ? [prevName] : [])],
      rows: cur.perQuestion.map((q) => {
        const before = prev?.perQuestion.find((x) => x.id === q.id)?.adjusted ?? null;
        return [
          `${questionLabel(q.id)}. ${q.text}`,
          q.adjusted === null ? NO_VALUE : cell(q.adjusted, 2),
          ...(prev && prevName ? [before === null ? NO_VALUE : cell(before, 2)] : []),
        ];
      }),
    },
  };
}
