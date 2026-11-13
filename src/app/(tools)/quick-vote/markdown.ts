/**
 * Quick Vote's export: every saved round, newest first, as the vote kit's
 * own tables (totals only), with the real answer to a guess and a value
 * saved to the backlog where the host added them.
 */

import { presetById } from "@/lib/quick-vote/presets";
import type { SavedResult } from "@/lib/quick-vote/results";
import type { CustomPreset } from "@/lib/quick-vote/state";
import { savedResultMarkdown } from "./model";

export function toMarkdown(
  results: readonly SavedResult[],
  presets: readonly CustomPreset[] = []
): string {
  const lines = ["# Quick Vote results", ""];
  if (results.length === 0) {
    lines.push("No rounds saved yet.");
  } else {
    lines.push(
      `${results.length} saved ${results.length === 1 ? "round" : "rounds"}, newest first. Only the totals are kept: nobody's answers or names.`
    );
    for (const saved of results) lines.push("", savedResultMarkdown(saved));
  }
  if (presets.length > 0) {
    lines.push("", "## Saved formats", "");
    for (const p of presets) {
      const base = presetById(p.draft.presetId)?.name ?? "Quick Vote";
      lines.push(
        `- ${p.name.replace(/\|/g, "\\|")} (${base}): ${p.draft.question.trim() || "no question yet"}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
