/**
 * Copyable prompts for Quick Vote: read the latest result with the team,
 * and look across the saved rounds. They carry totals only, as the page
 * keeps them; the questions and options are the host's text, so they are
 * cleaned and wrapped as user content.
 */

import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import { presetById } from "@/lib/quick-vote/presets";
import {
  presetName,
  resultKind,
  resultSummary,
  type SavedResult,
  type StoredChoiceResult,
  type StoredRankResult,
  type StoredScaleResult,
} from "@/lib/quick-vote/results";

/** The latest round's totals as a table: one row per answer. */
function totalsTable(saved: SavedResult): string {
  const r = saved.result;
  switch (resultKind(r)) {
    case "scale": {
      const s = r as StoredScaleResult;
      const d = s.questions[0]?.distribution;
      if (!d) return "Withheld: too few answers to show.";
      return formatTable(
        ["Answer", "People"],
        s.scale.points.map((p, i) => [sanitizePromptCell(p.label, 60), d[i]])
      );
    }
    case "choice": {
      const c = r as StoredChoiceResult;
      return formatTable(
        ["Option", c.mode === "dots" ? "Dots" : "People"],
        c.options.map((o) => [sanitizePromptCell(o.text, 80), o.total])
      );
    }
    case "rank": {
      const k = r as StoredRankResult;
      return formatTable(
        ["Option", "Points"],
        k.options.map((o) => [sanitizePromptCell(o.text, 80), o.points])
      );
    }
    case "number":
      return sanitizePromptCell(resultSummary(saved), 300);
  }
}

export function generateQuickVotePrompts(data: {
  results: readonly SavedResult[];
}): PromptDefinition[] {
  const latest = data.results[0];
  if (!latest) return [];
  const format = presetById(latest.presetId);
  const history = formatTable(
    ["Saved", "Format", "Question", "Result"],
    data.results
      .slice(0, 12)
      .map((s) => [
        s.savedAt.slice(0, 10),
        presetName(s),
        sanitizePromptCell(s.result.title, 100),
        sanitizePromptCell(resultSummary(s), 160),
      ])
  );
  return [
    {
      id: "quick-vote-latest",
      title: "Talk through the latest vote",
      description: "Questions to ask the team about the spread, not just the top answer.",
      prompt:
        buildPreamble(
          "Quick Vote",
          `The latest round was a ${format?.name ?? "poll"} answered by ${latest.result.ballots} people. Only totals were kept.`
        ) +
        `## The round\n\n${wrapUserContent(`Question: ${sanitizePromptCell(latest.result.title, 120)}\n\n${totalsTable(latest)}`)}\n\n` +
        "## Questions\n\n1. What does the spread say, beyond the top answer?\n2. Which three questions should the facilitator ask the room next, without asking anyone to justify their own vote?\n3. Is a follow-up round worth running, and with which format?",
    },
    {
      id: "quick-vote-history",
      title: "Patterns across the saved rounds",
      description: "Look for trends across the team's recent votes and checks.",
      prompt:
        buildPreamble(
          "Quick Vote",
          `${data.results.length} saved rounds, newest first. Totals only: nobody's answers or names.`
        ) +
        `## Saved rounds\n\n${wrapUserContent(history)}\n\n` +
        "## Questions\n\n1. What patterns or trends show across these rounds?\n2. Which result most deserves a conversation in the next retro, and why?\n3. Suggest one change to how the team runs its meetings, based on these results.",
    },
  ];
}
